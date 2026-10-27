# Local Advisor v2 port

## Approved direction

Build a local, v2-only port of StefanoBalocco/opencode-advisor at commit
`2c560e4818d8659fa977747e650a8dd94af6d6ed`. The user approved the staged
manual-first approach and local hosting before any upstream submission.
The isolated checkout is `/projects/opencode-advisor-v2`, branch
`local/v2-manual-port`. Do not commit, push, publish, or change daily profiles.

## First release

Register the existing `advisor()` tool and hidden consultant through
`@opencode/plugin@2.0.26`. Preserve the existing strategic prompt, optional
model/variant, custom prompt, temperature, and top_p semantics. Retain
strict option validation; explicitly reject unsupported automatic-recovery
and arbitrary provider options rather than silently pretending to support them.
Use the caller's active post-compaction context, excluding the calling
assistant message, and describe this boundary honestly.

The consultant uses an ordinary temporary session with the caller's location,
its own agent/model, and explicit read-only permissions. Prompt admission is
not a completion result. Observe the actual consultation output and terminal
execution state before returning advice. Keep at most one consultation per
source session, reject consultant recursion, and permit independent callers.
Propagate cancellation; impose a configurable positive deadline and bounded
cleanup. Cancel running consultation work before removal. Surface cleanup
failures without discarding useful advice. Dispose hooks on plugin unload.

Automatic failure recovery, full stored-history bridging, ensembles, and
background delivery are deferred. No speculative feature upgrades are needed
to prove the manual consultation.

## Local packaging and validation

Use a distinct private package identity, pinned v2 dependencies, compiled
entrypoint, and a lockfile. Preserve upstream attribution and history. Provide
home/work examples referencing the local package directory with their existing
models and variants, but do not activate them. Examples must follow the pinned
v2 schema and explain that arbitrary copied v1 options are not supported.

Verify the upstream baseline first, then develop behavioral tests before each
implementation change. Cover registration, options, context serialization,
prompt-admission/completion ordering, failures, same-session overlap,
independent sessions, recursion, cancellation, timeout, permissions, cleanup,
and unload. Validate emitted exports against the real v2 host and run an
isolated deterministic-provider end-to-end consultation. This proves host
integration without accessing the user's provider credentials; real home/work
provider calls remain explicitly unverified unless separately exercised.

## Known baseline

Upstream build and all 97 AVA tests passed on Node 22.23.3 before edits.
The existing v1 tests cover behavior that must be adapted; they are not proof
of v2 operation. The source repository has no codegraph index; it was consulted
and reported uninitialized before direct source reads.
