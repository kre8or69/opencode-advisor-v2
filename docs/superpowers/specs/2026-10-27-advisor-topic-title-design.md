# Advisor topic title — design

**Date:** 2026-10-27
**Repo:** `opencode-advisor-v2` (fork of `StefanoBalocco/opencode-advisor`, MIT)
**Status:** proposed — awaiting approval

## Intent

When an agent calls `advisor`, the TUI currently shows only the icon and the tool name
(`* advisor`). The calling agent knows what it is asking about; surface that in the tool card so a
human can see the question without opening the advisor’s child session.

## Goals

- Accept an optional one-line `topic` from the calling model.
- Display a human title such as `Advisor — choosing between A and B` while the consultation runs and
  after it completes.
- Give the advisor’s child session the same title so the task card is identifiable.
- Keep the existing no-argument call working.

## Non-goals

- No change to the advisor prompt, transcript, permissions, recursion guard, or model selection.
- No second model call just to generate a summary.
- No npm publication; the plugin stays a local/vendored plugin.

## Constraints found

- V2.1.4 `Tool.Info` has no `title` field. The TUI resolves a tool-part title from
  `state.title` (falling back to the tool name), and `state.title` is fed by tool metadata /
  `context.progress`.
- The plugin registers the tool with `codemode: false`; it is a normal timeline tool.
- The plugin must stay dependency-free at runtime (plain `{ id, setup }`, no `@opencode/*` imports
  in the built output).
- Two vendored copies must be updated: `home-v2` and `work-v2`.

## Approaches

1. **Auto-derive from the last user message** — no tool API change, but the last message is often
   long, stale, or unrelated to the actual question. Rejected as the primary mechanism.
2. **Optional `topic` argument + fallback** — the caller supplies a short summary; if omitted, use a
   generic “consulting” title. Most accurate and cheap. **Chosen.**
3. **Generate a summary with an extra model call** — accurate but adds cost/latency to every
   consultation. Rejected.

## Behavior

- Tool input becomes:
  ```json
  {
    "type": "object",
    "properties": {
      "topic": {
        "type": "string",
        "description": "One-line summary of the question or decision, for display only."
      }
    },
    "additionalProperties": false
  }
  ```
- Title normalization: collapse whitespace, strip newlines, truncate to 120 characters.
- Title text: `Advisor — <topic>` when provided; `Advisor — consulting…` otherwise.
- Set the title twice: `context.progress({ title })` before the consultation, and
  `metadata.title` in the returned result so the completed card keeps it.
- Child session title: `advisor — <topic>` (fallback `advisor — consulting`). The session is still
  identified by the hidden advisor agent and the `consultantSessions` set; no logic depends on the
  old literal `advisor-subcall`.
- Tool description gains one line asking the caller to pass a short `topic`.
- Auto-escalation (if enabled) passes a generated topic such as
  `auto-escalation after repeated tool errors`.

## Files

- `src/plugin.ts` — schema, title plumbing, child session title, description.
- `tests/src/plugin.test.ts` — topic accepted, title metadata/progress set, truncation, no-topic
  fallback, recursion/permission behavior unchanged.
- `dist/plugin.js` + `dist/plugin.d.ts` — rebuilt.
- Vendored copies in `home-v2` and `work-v2`.

## Verification

- `npm run build && npm run tests` in `opencode-advisor-v2`.
- Unit assertions on the title text and metadata.
- TUI spike in one profile: call `advisor` with and without `topic`, confirm the card shows the
  title (and that the prefix reads as desired). If the TUI replaces the tool name with the title,
  keep the `Advisor —` prefix; if it prefixes the name itself, drop the prefix.
- Repeat the consultation in `home-v2` and `work-v2`.

## Repo

- Private `kre8or69/opencode-advisor-v2`, `upstream` = `StefanoBalocco/opencode-advisor`.
- Commit the existing v2 port (currently uncommitted on `local/v2-manual-port`) plus this feature.
- Add `.gitignore` for `node_modules/`, `coverage/`, and editor/build temp files; keep `dist/`
  tracked because local plugins load it directly.

## Rollback

Restore the previous `dist/plugin.js` in both profiles (or re-vendor the prior build); the tool
schema only adds an optional property, so older callers remain compatible.

## Open decisions

- Repo visibility: private (recommended) or public.
- Title prefix: `Advisor —` vs letting the TUI show the tool name plus the topic (resolved by the
  spike).
