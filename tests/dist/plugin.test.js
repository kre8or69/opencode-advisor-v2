import plugin from '../../dist/plugin.js';
const definition = plugin;
export { definition };
export function user(id, text) {
    return { id, type: 'user', text, time: { created: 1 } };
}
export function assistant(id, text, extra = {}) {
    return { id, type: 'assistant', agent: 'opencode-advisor:advisor', model: { providerID: 'openai', id: 'gpt-6.1-sol' },
        content: [{ type: 'text', text }], time: { created: 1, completed: 2 }, ...extra };
}
export function idle(outcome) { return { id: 'msg_idle', type: 'idle', outcome, time: { created: 3 } }; }
export function compaction(summary, recent) {
    return { id: 'msg_compaction', type: 'compaction', status: 'completed', reason: 'manual', summary, metadata: { recent }, time: { created: 0 } };
}
export function session(id) {
    return { id, projectID: 'project', agent: 'build', location: { directory: '/workspace' }, cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 1, updated: 1 } };
}
export function admission(sessionID, id) {
    return { id, sessionID, type: 'user', payload: { text: 'Transcript' }, delivery: 'steer', time: { created: 1 } };
}
