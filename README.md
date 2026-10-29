# OpenCode Advisor Plugin

Adds an `advisor()` tool to OpenCode. The tool consults a hidden internal agent with fixed read-only permissions.

> **Fork:** This repository is a fork of
> [StefanoBalocco/opencode-advisor](https://github.com/StefanoBalocco/opencode-advisor),
> adapted for OpenCode v2. Upstream remains the original project; see [License](#license).

## Install

Clone this repository and reference the plugin directory from the v2 `plugins` array in `opencode.json`:

```json
{
  "plugins": [
    { "package": "/absolute/path/to/opencode-advisor-v2" }
  ]
}
```

The `package` path must be absolute and point at the checkout. This fork's package is local and private; it is not published to npm.

The plugin works without options.

## Configuration

Pass options under the plugin entry's `options` object:

```json
{
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-advisor-v2",
      "options": {
        "model": "anthropic/claude-opus-4-7",
        "variant": "high"
      }
    }
  ]
}
```

### Model resolution

The plugin uses the `model` option, or the `deepseek/deepseek-v4-pro` fallback when it is omitted. The `model` field must use `provider/model` format with non-empty provider and model segments. An optional `#variant` suffix is supported; the separate `variant` option overrides it.

### Profile fields

| Field | Type | When omitted |
| --- | --- | --- |
| `model` | `"provider/model"` (optional `#variant`) | `deepseek/deepseek-v4-pro` |
| `variant` | string | Uses the `model` suffix, if present. |
| `prompt` | string | Uses the built-in system prompt. |
| `temperature` | finite number | Not sent (provider default). |
| `top_p` | finite number | Not set. |
| `timeoutMs` | positive, timer-safe integer | `120000` |

A supplied `prompt` replaces the built-in system prompt. `temperature` is sent only when explicitly configured; omit it for OpenAI GPT-6.1 reasoning models, which reject the parameter. Unknown options are rejected at startup. The plugin does not read environment variables; configure it through the plugin entry's `options` object.

## Fixed permissions

The hidden agent uses this non-configurable permission policy:

| Tool or action | Policy |
| --- | --- |
| `read` | allow |
| `glob` | allow |
| `grep` | allow |
| `webfetch` | allow |
| `websearch` | allow |
| `skill` | allow |
| `edit` | deny |
| All other tools | deny |

The `shell` action is denied, so the hidden agent cannot run any shell command, including `git` or `wc`.

This policy cannot be overridden. The hidden agent cannot write files, use LSP, invoke tasks or todos, access MCP tools, or run arbitrary shell commands.

## How it works

1. The executor receives the `advisor()` tool.
2. The executor calls it, optionally with a topic.
3. The plugin fetches the session transcript, excluding the calling message.
4. The plugin creates an ephemeral session and prompts the hidden `opencode-advisor:advisor` agent.
5. The hidden agent supplies its model, system prompt, and permissions. It sends `temperature` only when configured.
6. The tool returns the response text.
7. The plugin deletes the ephemeral session.

The hidden agent can inspect the workspace and public web with read-only tools. It cannot edit files or run arbitrary shell commands.

## Topic labels

`advisor()` accepts an optional `topic` argument. The topic is stored in the tool result metadata as the consultation title and is used for the hidden consultant session title. The TUI may also render the topic as the tool input:

```json
{ "topic": "choosing between A and B" }
```

The topic is for display only and does not change the transcript or the advice. Whitespace is collapsed to a single line, and topics longer than 120 characters are truncated with an ellipsis. When `topic` is omitted, the title is `Advisor — consulting…` and the consultant session is named `advisor — consulting`.

## Not implemented in this v2 port

The manual v2 port does not implement auto-escalation. The `failureThreshold` option is rejected by the option parser; `advisor()` runs only when the caller invokes it explicitly.

## Requirements

- OpenCode 2.1.4
- Provider authentication configured through `/connect` in OpenCode

## Development

```bash
npm install
npm run build
npm run tests
```

The build compiles `src/plugin.ts` and `tests/src/plugin.test.ts` to JavaScript. The package entry is `dist/plugin.js`.

## License

MIT
