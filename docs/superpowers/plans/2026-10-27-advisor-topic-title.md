# Advisor Topic Title Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the advisor’s question as a human title in the TUI instead of a bare `advisor` tool name.

**Architecture:** Add an optional `topic` string to the existing `advisor` tool schema, normalize it, and feed it to the tool’s progress/result metadata and the advisor child session title. The advisor’s prompt, transcript, permissions, and lifecycle stay unchanged.

**Tech Stack:** TypeScript, ava, OpenCode v2.1.4 plugin API (`Tool.Info.input`, `ToolContext.progress`, `Tool.Result.metadata`).

**Spec:** `docs/superpowers/specs/2026-10-27-advisor-topic-title-design.md`

## Global Constraints

- Runtime output must stay dependency-free: no `@opencode/*` imports in `dist/plugin.js`.
- Keep `options: { codemode: false }`.
- The `topic` property is optional; calls without it must behave exactly as today.
- Title format: `Advisor — <topic>`; fallback `Advisor — consulting…`.
- Child session title: `advisor — <topic>`; fallback `advisor — consulting`.
- Normalize the topic: collapse whitespace/newlines, trim, truncate to 120 characters with a trailing `…`.
- Target OpenCode 2.1.4; do not change the advisor model or options parsing.
- Do not publish to npm; the plugin stays vendored in `home-v2` and `work-v2`.

## Review Focus

- A topic containing newlines, tabs, or 200+ characters must produce one clean line of at most 120 characters (test in Task 1).
- A call with no input (every existing caller) must still work and show the fallback title (test in Task 1).
- The title must be set before the slow consultation starts, not only at the end, so the running card is labeled (test asserts `progress` was called before `consult`’s create/prompt).
- A consultation failure must still return the title metadata (existing error tests plus the topic test).
- Vendoring must not leave the two profiles on different builds (Task 2 checks both copies by hash).

---

### Task 1: Topic input and title plumbing

**Files:**
- Modify: `src/plugin.ts:202-217` (tool registration) and `src/plugin.ts:110-190` (`consult`)
- Modify: `tests/native.test.js` (host fixture and new tests)
- Test: `tests/native.test.js`

**Interfaces:**
- Consumes: `ToolContext.progress(update)` and `Tool.Result.metadata` from `@opencode/plugin` 2.1.4.
- Produces:
  - `normalizeTopic(value: unknown): string | undefined`
  - `advisorTitle(topic: string | undefined): string`
  - `consultantTitle(topic: string | undefined): string`
  - `consult(sourceID: string, messageID: string, signal: AbortSignal, topic?: string)`

- [ ] **Step 1: Write the failing tests**

In `tests/native.test.js`, add `progress: []` to the `host()` return object and pass a progress spy into the tool context. Change `run` to accept an input:

```js
run(sessionID='ses_source', extra={}, input={}){
  return tools.advisor.execute(input, {sessionID,messageID:'msg_current',agent:'build',
    signal:new AbortController().signal,
    progress:async update=>{h.progress.push(update);},...extra});
}
```

Add these tests after the first registration test:

```js
test('topic labels the consultation card and child session', async t => {
  const h = host(); await h.setup();
  const r = await h.run('ses_source', {}, { topic: '  choosing between A\nand B  ' });
  t.is(r.content, 'Advice');
  t.is(r.metadata.title, 'Advisor — choosing between A and B');
  t.deepEqual(h.progress[0], { title: 'Advisor — choosing between A and B' });
  t.is(h.calls.find(c => c[0] === 'create')[1].title, 'advisor — choosing between A and B');
  await h.cleanup();
});

test('no topic uses the consulting fallback', async t => {
  const h = host(); await h.setup();
  const r = await h.run();
  t.is(r.metadata.title, 'Advisor — consulting…');
  t.is(h.calls.find(c => c[0] === 'create')[1].title, 'advisor — consulting');
  await h.cleanup();
});

test('topic is truncated to one line of 120 characters', async t => {
  const h = host(); await h.setup();
  const r = await h.run('ses_source', {}, { topic: 'x'.repeat(200) });
  t.is(r.metadata.title, `Advisor — ${'x'.repeat(119)}…`);
  t.false(r.metadata.title.includes('\n'));
  await h.cleanup();
});
```

Update the existing schema assertion:

```js
t.deepEqual(h.tools.advisor.input, {
  type: 'object',
  properties: { topic: { type: 'string', description: 'One-line summary of the question or decision, for display only.' } },
  additionalProperties: false
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build && npm run tests`
Expected: FAIL — the schema has no `topic` property, `progress` is never called, and `metadata` is undefined.

- [ ] **Step 3: Implement the topic helpers and plumbing**

In `src/plugin.ts`, add near `parseModel`:

```ts
const topicDescription = 'One-line summary of the question or decision, for display only.';
const topicMaxLength = 120;
function normalizeTopic(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const topic = value.replace(/\s+/g, ' ').trim();
  if (!topic) return undefined;
  return topic.length > topicMaxLength ? `${topic.slice(0, topicMaxLength - 1)}…` : topic;
}
function advisorTitle(topic: string | undefined): string {
  return topic ? `Advisor — ${topic}` : 'Advisor — consulting…';
}
function consultantTitle(topic: string | undefined): string {
  return topic ? `advisor — ${topic}` : 'advisor — consulting';
}
```

Change `consult` to accept the topic and use it for the child session title:

```ts
async function consult(sourceID:string, messageID:string, signal:AbortSignal, topic?: string) {
  // ...
  creation=ctx.session.create({title:consultantTitle(topic),agent:advisorAgent,model:options.model,
    location:source.location,permissions:permissions()},{signal});
```

Register the optional input and set the title:

```ts
input:{type:'object',properties:{topic:{type:'string',description:topicDescription}},additionalProperties:false},
async execute(input, context){
  // existing guards...
  const topic = normalizeTopic((input as {topic?: unknown} | undefined)?.topic);
  const title = advisorTitle(topic);
  await context.progress({ title });
  // ...
  const done = consult(context.sessionID, context.messageID, controller.signal, topic)
    .then(result => ({ ...result, metadata: { ...(result.metadata ?? {}), title } }))
    .finally(() => { clearTimeout(timer); context.signal.removeEventListener('abort', cancel); calls.delete(context.sessionID); });
  calls.set(context.sessionID, { controller, done });
  return done;
},
```

Add one line to the `description` constant:

```text
Pass a short "topic" summarizing the question (for example, "choosing between A and B") so the UI can label the consultation. It is for display only.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run build && npm run tests`
Expected: PASS — all existing tests plus the three new topic tests.

- [ ] **Step 5: Update the README**

Add a short “Topic labels” section documenting the optional `topic` argument and the fallback.

- [ ] **Step 6: Commit**

```bash
git add src/plugin.ts tests/native.test.js dist/plugin.js dist/plugin.d.ts dist/plugin.js.map README.md
git commit -m "feat: label advisor consultations with an optional topic"
```

---

### Task 2: Vendor the build into both v2 profiles and verify

**Files:**
- Modify: `~/.config/opencode-profiles/home-v2/local-plugins/opencode-advisor-v2/{index.js,dist/plugin.js}`
- Modify: `~/.config/opencode-profiles/work-v2/local-plugins/opencode-advisor-v2/{index.js,dist/plugin.js}`

**Interfaces:**
- Consumes: the built `dist/plugin.js` from Task 1.
- Produces: identical vendored builds in both profiles.

- [ ] **Step 1: Build and hash the source artifact**

```bash
cd /projects/opencode-advisor-v2
npm run build
sha256sum dist/plugin.js
```

- [ ] **Step 2: Copy to both profiles**

```bash
for p in home work; do
  dest="$HOME/.config/opencode-profiles/$p-v2/local-plugins/opencode-advisor-v2"
  cp index.js "$dest/index.js"
  cp dist/plugin.js "$dest/dist/plugin.js"
done
sha256sum "$HOME/.config/opencode-profiles/"*/local-plugins/opencode-advisor-v2/dist/plugin.js
```

Expected: three identical hashes (source, home-v2, work-v2).

- [ ] **Step 3: Manual TUI check (user gate)**

Open `och` and `ocw`, have the agent call `advisor` with a topic, and confirm the card reads `Advisor — <topic>` (or the prefix the TUI actually needs). If the TUI prefixes the tool name itself, drop the `Advisor — ` prefix from `advisorTitle` and re-run Task 1’s tests.

- [ ] **Step 4: Commit and push**

```bash
git add dist/plugin.js dist/plugin.d.ts dist/plugin.js.map
git commit -m "chore: vendor advisor topic title into v2 profiles"
git push origin v2
```
