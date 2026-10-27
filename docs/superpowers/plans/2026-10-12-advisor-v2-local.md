# Advisor v2 local port implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Do not commit or push; the user asked for a local trial.

**Goal:** Produce a usable, locally loadable manual Advisor plugin for OpenCode 2.0.26, with independent lifecycle tests and an isolated real-host smoke test.

**Architecture:** A native promise-style backend plugin registers one hidden advisor and one directly callable tool. Consultation operates on active context in a temporary session, observes completion rather than prompt admission, and owns per-call cancellation, recursion guards, timeout, and cleanup.

**Tech Stack:** TypeScript, Node 22, AVA, @opencode/plugin and @opencode/cli 2.0.26.

---

## Task 1: Implement the manual v2 plugin and behavioral tests

**Files:** `src/plugin.ts`, optionally focused `src/profile.ts` and `src/consultation.ts`, `tests/src/plugin.test.ts`, `package.json`, `package-lock.json`, `tsconfig.json`, and existing build/test configuration.

- [x] Establish baseline with `npm install --ignore-scripts`, `npm run build`, and `npm run tests`: 97 passing tests, 100% upstream coverage.
- [ ] Inspect the installed, pinned v2 declarations before selecting exact methods. The migration reference is `/projects/research_notes/Advisor v2 fork feasibility/v2-migration.md`; verify it against actual installed types.
- [ ] Write tests asserting the new native entrypoint and desired consultation behavior; run them against the old factory and record expected failures before production edits.
- [ ] Change package identity to private `@local/opencode-advisor-v2`; pin v2 plugin and CLI dependencies and install only into this checkout.
- [ ] Implement `Plugin.define({ id: "opencode-advisor", async setup(ctx) { ... } })`, `ctx.options`, agent transform/upsert, native JSON Schema tool registration, and read-only consultant policy.
- [ ] Implement active-context text formatting and create/prompt/observe/result/cleanup using verified native methods. Add and run regression tests before cancellation, concurrency, timeout, and failure handling implementations.
- [ ] Reject unsupported options explicitly; preserve home/work model references and variants in supported options. Require no new tool arguments for existing invocation.
- [ ] Run `npm run build`, the adapted behavioral tests, and `tsc --noEmit`; compare real API types rather than passing tests through untyped SDK casts.
- [ ] Obtain spec compliance review, fix gaps, then code-quality review and fix findings before proceeding.

## Task 2: Real-host smoke test and local usage

**Files:** `tests/integration/` scripts/configuration, `examples/home.json`, `examples/work.json`, `README.md`, `AGENTS.md`, and `LOCAL-PORT.md`.

- [ ] Inspect the pinned CLI help and configuration schema, then create an isolated temporary config/data/cache/state environment with no inherited plugins, MCP servers, or user provider credentials.
- [ ] Build a deterministic local provider whose caller requests `advisor()` and whose consultant returns a distinct marker. Confirm the v2 host loads the compiled plugin, executes the consultation, returns the marker to the caller, and removes its temporary session. Do not label a fake-context unit test as runtime integration.
- [ ] Keep runtime fixtures reproducible and credential-free; verify process teardown and temporary-directory cleanup.
- [ ] Write local package-directory loading examples with home `ollama-cloud/kimi-k3` variant `max`, work `openai/gpt-6.1-sol` variant `xhigh`; validate their plugin declaration shape against the pinned schema. Do not copy provider secrets or activate examples.
- [ ] Document install/build/test commands, the active-context boundary, deferred automatic recovery, unsupported options, runtime evidence, upstream origin, and rollback by removing the local plugin declaration and restarting.
- [ ] Run final tests/build/smoke/package inspection and inspect `git status`/`git diff`. Obtain spec and quality reviews. Save verification results to `LOCAL-PORT.md` and request final advisor review. Leave the local branch uncommitted and unpushed.
