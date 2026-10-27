const advisorAgent = 'opencode-advisor:advisor';
const defaultPrompt = `Act as a strategic advisor to a coding agent. Read the conversation transcript, identify the current objective, and provide a concise plan or course correction.

Give the executor clear, ordered instructions. State what to do next, the sequence to follow, the main risks, and the actions to avoid. Prefer the simplest solution that satisfies the specification. Flag choices that add unnecessary code, indirection, or maintenance burden. When the executor is stuck, repeating failed attempts, or following a disproved assumption, redirect the approach. State plainly when tests, logs, or other evidence contradict the current reasoning.

Use read-only tools only when they add necessary context. You may inspect the workspace with "read", "glob", and "grep", consult public sources with "webfetch" and "websearch", and load relevant skills. Do not edit files, change system state, or run shell commands.

Respond in fewer than 300 words. Use numbered steps. Do not write code; provide advice only.`;
const description = `Consult a strategic advisor that reads the text of the active post-compaction conversation context and returns a concise plan or course correction. Earlier history is represented only by available compaction summaries; the calling assistant message, reasoning, files, and tool results are excluded.

Call "advisor" before substantive work: writing code, editing files, choosing an interpretation, or relying on an unverified assumption. Complete only the orientation needed to inform the review—locate files, read code, or fetch documentation—then call the advisor. Orientation is not substantive work.

Call it again when the approach stalls, errors recur, results contradict expectations, or a different direction appears necessary. Request a final review before declaring the task complete. First preserve the deliverable in its proper durable form by saving files or results and committing only when the task requires a commit.

For tasks longer than a few steps, consult the advisor before choosing an approach and again before completion. Skip it only on short, reactive turns where tool output directly determines the next action.

Give the advice serious weight. Override a specific recommendation only when primary-source evidence disproves it. Present the conflict in another advisor call instead of changing course silently.

Pass a short "topic" summarizing the question (for example, "choosing between A and B") so the UI can label the consultation. It is for display only.`;
const safeTools = new Set(['read', 'glob', 'grep', 'webfetch', 'websearch', 'skill']);
function permissions() {
    return [{ action: '*', resource: '*', effect: 'deny' },
        ...[...safeTools].map(action => ({ action, resource: '*', effect: 'allow' })),
        { action: 'shell', resource: '*', effect: 'deny' }];
}
function parseModel(input, override) {
    const match = /^([^/\s#]+)\/([^\s#]+)(?:#([^\s#]+))?$/.exec(input);
    if (!match)
        throw Error('advisor model must be provider/model optionally followed by #variant');
    const variant = override ?? match[3];
    return { providerID: match[1], id: match[2],
        ...(variant !== undefined ? { variant: variant } : {}) };
}
const topicDescription = 'One-line summary of the question or decision, for display only.';
const topicMaxLength = 120;
function normalizeTopic(value) {
    if (typeof value !== 'string')
        return undefined;
    const topic = value.replace(/\s+/g, ' ').trim();
    if (!topic)
        return undefined;
    return topic.length > topicMaxLength ? `${topic.slice(0, topicMaxLength - 1)}…` : topic;
}
function advisorTitle(topic) {
    return topic ? `Advisor — ${topic}` : 'Advisor — consulting…';
}
function consultantTitle(topic) {
    return topic ? `advisor — ${topic}` : 'advisor — consulting';
}
function parseOptions(raw) {
    if (raw === undefined)
        raw = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype)
        throw Error('advisor options must be a plain object');
    const o = raw;
    for (const key of Object.keys(o))
        if (!['model', 'variant', 'prompt', 'temperature', 'top_p', 'timeoutMs'].includes(key))
            throw Error(`advisor option ${key} is unsupported in the manual v2 port`);
    for (const key of ['model', 'variant', 'prompt'])
        if (o[key] !== undefined && typeof o[key] !== 'string')
            throw Error(`advisor option ${key} must be a string`);
    for (const key of ['temperature', 'top_p'])
        if (o[key] !== undefined && (typeof o[key] !== 'number' || !Number.isFinite(o[key])))
            throw Error(`advisor option ${key} must be finite`);
    const timeoutMs = o.timeoutMs ?? 120000;
    if (typeof timeoutMs !== 'number' || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647)
        throw Error('advisor timeoutMs must be a positive timer-safe integer');
    const model = parseModel((o.model ?? 'deepseek/deepseek-v4-pro'), o.variant);
    return { model,
        prompt: o.prompt ?? defaultPrompt,
        temperature: o.temperature ?? 0,
        topP: o.top_p, timeoutMs };
}
function transcript(messages, excludedID) {
    return messages.filter(m => m.id !== excludedID).flatMap(m => {
        if (m.type === 'user')
            return m.text.trim() ? [`User: ${m.text}`] : [];
        if (m.type === 'assistant') {
            const text = m.content.filter(p => p.type === 'text').map(p => p.text).join('');
            return text.trim() ? [`Assistant: ${text}`] : [];
        }
        if (m.type === 'compaction' && m.status === 'completed') {
            const recent = typeof m.metadata?.recent === 'string' ? m.metadata.recent : '';
            if (m.summary.trim() || recent.trim())
                return [`Compaction summary: ${m.summary}\n${recent}`];
        }
        return [];
    }).join('\n\n');
}
function errorText(error) { return error instanceof Error ? error.message : String(error); }
function checked(signal) { if (signal.aborted)
    throw signal.reason ?? Error('Advisor cancelled'); }
function abortable(promise, signal) {
    return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason ?? Error('Advisor cancelled'));
        signal.addEventListener('abort', abort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
        if (signal.aborted)
            abort();
    });
}
async function bounded(operation) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(Error('cleanup timed out')), 1000);
    try {
        return await abortable(operation(controller.signal), controller.signal);
    }
    finally {
        clearTimeout(timer);
    }
}
function pause(signal) {
    return new Promise((resolve, reject) => {
        const done = () => { signal.removeEventListener('abort', abort); resolve(); };
        const timer = setTimeout(done, 20);
        const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted)
            abort();
    });
}
const plugin = { id: 'opencode-advisor', async setup(ctx) {
        const options = parseOptions(ctx.options);
        const registrations = [];
        let unloaded = false;
        const calls = new Map();
        const consultantSessions = new Set();
        async function cleanupSession(sessionID, interrupt) {
            const failures = [];
            if (interrupt)
                try {
                    await bounded(signal => ctx.session.interrupt({ sessionID, resume: false }, { signal }));
                }
                catch (error) {
                    failures.push(`interrupt: ${errorText(error)}`);
                }
            if (interrupt)
                try {
                    await bounded(signal => ctx.session.wait({ sessionID }, { signal }));
                }
                catch (error) {
                    failures.push(`execution settlement: ${errorText(error)}`);
                }
            try {
                await bounded(signal => ctx.session.remove({ sessionID }, { signal }));
            }
            catch (error) {
                failures.push(`remove: ${errorText(error)}`);
            }
            return failures;
        }
        async function consult(sourceID, messageID, signal, topic) {
            let sessionID;
            let creation;
            let admission;
            let completed = false, content = '', eventError;
            const events = new AbortController();
            let reader;
            const warnings = [];
            try {
                checked(signal);
                const messages = await abortable(ctx.session.context({ sessionID: sourceID }, { signal }), signal);
                const text = transcript(messages, messageID);
                if (!text.trim())
                    return { content: 'Advisor declined: no prior conversation to analyze.' };
                const source = await abortable(ctx.session.get({ sessionID: sourceID }, { signal }), signal);
                if (source.agent === advisorAgent)
                    throw Error('Advisor cannot be called recursively');
                checked(signal);
                creation = ctx.session.create({ title: consultantTitle(topic), agent: advisorAgent, model: options.model,
                    location: source.location, permissions: permissions() }, { signal });
                creation.then(session => { sessionID = session.id; consultantSessions.add(session.id); }, () => { });
                const session = await abortable(creation, signal);
                sessionID = session.id;
                checked(signal);
                let terminal;
                reader = (async () => {
                    try {
                        for await (const event of ctx.event.subscribe({ signal: events.signal })) {
                            if (!('sessionID' in event.data))
                                continue;
                            if (event.data.sessionID === sourceID && event.type === 'session.deleted')
                                throw Error('source session deleted');
                            if (event.data.sessionID !== sessionID)
                                continue;
                            if (event.type === 'session.deleted')
                                throw Error('consultant session deleted');
                            if (event.type === 'session.execution.succeeded')
                                terminal = 'succeeded';
                            if (event.type === 'session.execution.failed')
                                terminal = 'failed';
                            if (event.type === 'session.execution.interrupted')
                                terminal = 'interrupted';
                        }
                    }
                    catch (error) {
                        if (!events.signal.aborted)
                            eventError = error;
                    }
                })();
                admission = ctx.session.prompt({ sessionID, text }, { signal });
                const input = await abortable(admission, signal);
                while (true) {
                    checked(signal);
                    if (eventError)
                        throw eventError;
                    if (terminal === 'failed' || terminal === 'interrupted')
                        throw Error(`Advisor execution ${terminal}`);
                    {
                        const output = await abortable(ctx.session.context({ sessionID }, { signal }), signal);
                        const boundary = output.findIndex(m => m.type === 'user' && m.id === input.id);
                        if (boundary >= 0) {
                            const tail = output.slice(boundary + 1);
                            if (tail.some(m => m.type === 'user'))
                                throw Error('Advisor input correlation lost: another user turn was admitted');
                            const idle = tail.findIndex(m => m.type === 'idle');
                            if (idle >= 0) {
                                const end = tail[idle];
                                if (end.type === 'idle' && end.outcome !== 'succeeded')
                                    throw Error(`Advisor execution ${end.outcome}`);
                                const responses = tail.slice(0, idle).filter(m => m.type === 'assistant' && m.agent === advisorAgent);
                                if (responses.some(m => m.type === 'assistant' && m.error))
                                    throw Error('Advisor assistant failed');
                                if (responses.every(m => m.type === 'assistant' && m.time.completed !== undefined)) {
                                    content = responses.flatMap(m => m.type === 'assistant' ? m.content.filter(p => p.type === 'text').map(p => p.text) : []).join('\n').trim();
                                    completed = true;
                                    content ||= 'Advisor returned no advice.';
                                    break;
                                }
                            }
                        }
                    }
                    await pause(signal);
                }
            }
            catch (error) {
                content = `Advisor error: ${errorText(error)}`;
            }
            finally {
                events.abort();
                if (reader)
                    try {
                        await bounded(() => reader);
                    }
                    catch (error) {
                        warnings.push(`event reader: ${errorText(error)}`);
                    }
                if (!sessionID && creation)
                    try {
                        await bounded(() => creation);
                    }
                    catch (error) {
                        warnings.push(`create settlement: ${errorText(error)}`);
                        void creation.then(async (late) => { await cleanupSession(late.id, true); consultantSessions.delete(late.id); }, () => { });
                    }
                if (admission && signal.aborted)
                    try {
                        await bounded(() => admission);
                    }
                    catch (error) {
                        warnings.push(`prompt settlement: ${errorText(error)}`);
                        const ownedID = sessionID;
                        if (ownedID)
                            void admission.then(() => cleanupSession(ownedID, true), () => { });
                    }
                if (sessionID) {
                    warnings.push(...await cleanupSession(sessionID, !completed));
                    consultantSessions.delete(sessionID);
                }
            }
            return { content: content + (warnings.length ? `\n\nAdvisor cleanup warning: ${warnings.join('; ')}` : '') };
        }
        try {
            registrations.push(await ctx.agent.transform(editor => editor.update(advisorAgent, agent => {
                agent.mode = 'subagent';
                agent.hidden = true;
                agent.system = options.prompt;
                agent.model = options.model;
                agent.permissions = permissions();
            })));
            registrations.push(await ctx.session.hook('context', event => {
                if (event.agent !== advisorAgent)
                    return;
                event.options.temperature = options.temperature;
                if (options.topP !== undefined)
                    event.options.topP = options.topP;
                for (const name of Object.keys(event.tools))
                    if (!safeTools.has(name))
                        delete event.tools[name];
            }));
            registrations.push(await ctx.tool.transform(editor => editor.add({
                name: 'advisor', description, options: { codemode: false },
                input: { type: 'object', properties: { topic: { type: 'string', description: topicDescription } }, additionalProperties: false },
                async execute(input, context) {
                    if (unloaded)
                        return { content: 'Advisor unavailable: plugin unloaded.' };
                    if (context.agent === advisorAgent || consultantSessions.has(context.sessionID))
                        return { content: 'Advisor cannot be called recursively.' };
                    if (calls.has(context.sessionID))
                        return { content: 'Advisor consultation already in progress for this session.' };
                    const topic = normalizeTopic(input?.topic);
                    const title = advisorTitle(topic);
                    const controller = new AbortController();
                    const cancel = () => controller.abort(Error('Advisor cancelled'));
                    context.signal.addEventListener('abort', cancel, { once: true });
                    if (context.signal.aborted)
                        cancel();
                    const timer = setTimeout(() => controller.abort(Error('Advisor timed out')), options.timeoutMs);
                    const done = context.progress({ title })
                        .then(() => consult(context.sessionID, context.messageID, controller.signal, topic))
                        .then(result => ({ ...result, metadata: { ...(result.metadata ?? {}), title } }))
                        .finally(() => {
                        clearTimeout(timer);
                        context.signal.removeEventListener('abort', cancel);
                        calls.delete(context.sessionID);
                    });
                    calls.set(context.sessionID, { controller, done });
                    return done;
                },
            })));
        }
        catch (error) {
            await Promise.all(registrations.map(r => r.dispose()));
            throw error;
        }
        return async () => {
            unloaded = true;
            for (const call of calls.values())
                call.controller.abort(Error('Advisor cancelled: plugin unloaded'));
            await Promise.allSettled([...calls.values()].map(call => call.done));
            const disposed = await Promise.allSettled(registrations.map(r => r.dispose()));
            const failed = disposed.filter(r => r.status === 'rejected');
            if (failed.length)
                throw Error(`Advisor disposal failed: ${failed.map(r => errorText(r.reason)).join('; ')}`);
        };
    } };
export default plugin;
//# sourceMappingURL=plugin.js.map