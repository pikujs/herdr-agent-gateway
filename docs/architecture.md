# Architecture Specification — Herdr Agent Gateway

## 1. Overview & System Context

**Herdr Agent Gateway** provides an authenticated, structured gateway between remote AI coding agents (Claude Code, Cursor, OpenCode, Codex, CI/CD pipelines) and a local developer workstation running the **Herdr** terminal multiplexer (`~/.nix-profile/bin/herdr`).

It enables remote agents to:
- Introspect existing Herdr workspaces, tabs, panes, and agent lifecycle states.
- Request non-intrusive workspace pane splits without stealing developer keyboard focus.
- Initialize supported coding agents (`claude`, `codex`, `opencode`, `cursor`, etc.).
- Inject initial task prompts and follow-up instructions directly into agent PTYs without shell escaping vulnerabilities.

---

## 2. Process Model: Plugin vs. Standalone Server

According to the official Herdr documentation (`https://herdr.dev/docs/plugins/`):
> *"Startup hooks are one-shot initialization commands rather than supervised daemons. A hook should restore plugin-owned state, call any required Herdr APIs, and exit."*

Because Herdr's native plugin architecture does not provide a daemon supervisor loop, running a persistent HTTP server directly inside a `[[startup]]` hook would either block Herdr's initialization or run unmonitored.

### The Hybrid Service Architecture
We implement the proven pattern established by `herdr-go`:
1. **Core Gateway Daemon**:
   - A standalone background HTTP service written in TypeScript / Bun (`Bun.serve`).
   - Runs under `systemd --user` (`herdr-agent-gateway.service`) on Linux (or LaunchAgent on macOS).
   - Survives Herdr restarts, configuration reloads, and detached session exits.
2. **First-Class Herdr Plugin Integration**:
   - Manifested in `herdr-plugin.toml`.
   - Exposes native Herdr actions:
     - `herdr plugin action invoke gateway.setup` (installs and enables the systemd user service).
     - `herdr plugin action invoke gateway.status` (verifies HTTP reachability and daemon health).
     - `herdr plugin action invoke gateway.restart` (restarts the user service).
   - Adheres to standard Herdr plugin directories:
     - Config: `~/.config/herdr/plugins/config/herdr-remote-gateway/`
     - State: `~/.local/state/herdr/plugins/herdr-remote-gateway/`

---

## 3. Communication Layer: Unix Socket IPC with CLI Fallback

The gateway communicates with the local Herdr daemon via a tiered client adapter:

```
                  ┌───────────────────────────────┐
                  │    Herdr Client Adapter       │
                  └──────────────┬────────────────┘
                                 │
                 Is ~/.config/herdr/herdr.sock
                 connected and responsive?
                                 │
                    ┌────────────┴────────────┐
                    │ YES                     │ NO / Socket Error
                    ▼                         ▼
      ┌───────────────────────────┐  ┌───────────────────────────┐
      │ Direct Unix Domain Socket │  │ CLI Process Subprocess    │
      │ (JSON-Lines streaming)    │  │ (herdr <subcommand> --json│
      │ Latency: < 15ms           │  │ Latency: ~100-200ms       │
      └───────────────────────────┘  └───────────────────────────┘
```

### Primary: Direct Unix Domain Socket (`herdr.sock`)
- Socket: `process.env.HERDR_SOCKET_PATH ?? "~/.config/herdr/herdr.sock"`.
- Protocol: Newline-delimited JSON-RPC messages conforming to official Herdr Socket API (`https://herdr.dev/docs/socket-api/`).
  - Request: `{"id": "req_01", "method": "pane.split", "params": { ... }}\n`
  - Atomic prompt: `{"id": "req_02", "method": "agent.prompt", "params": { "prompt": "...", "wait": { "until": ["idle", "blocked"] } }}\n`
- Zero process-spawning overhead, sub-15ms response latency.

### Fallback: CLI Invocation (`herdr` CLI)
- If socket connection encounters transient framing errors or OS transport mismatches, the adapter falls back to `execFile(process.env.HERDR_BIN_PATH ?? "herdr", [...args, "--json"])`.

---

## 4. Workspace & Pane Routing Policy

When an external agent invokes `POST /api/v1/agents/spawn`:

1. **Target Workspace Resolution**:
   - If `"workspace"` is explicitly provided:
     - Find existing workspace matching the name or ID.
     - If it does not exist, create it via `workspace.create`.
   - If `"workspace"` is **omitted / null**:
     - The gateway routes the request to a dedicated workspace named **`spawned-agents`**.
     - If `spawned-agents` does not exist, the gateway automatically creates it.
     - **Benefit**: Keeps developer active coding sessions clean and isolated from background automated agents.

2. **Split Geometry & Non-Focus Guarantee**:
   - The pane is split with `--no-focus` (`focus: false`).
   - The developer's active cursor and typing stream are strictly undisturbed.
   - Default split direction: `"right"` (configurable to `"down"`).

---

## 5. Security & Hardening Model

1. **Network Interface Binding**:
   - `HERDR_GATEWAY_HOST` (default `127.0.0.1`). Binding to `0.0.0.0` is allowed only when explicitly specified.
   - `HERDR_GATEWAY_PORT` (default `9480`). Both host and port are independently configurable.
2. **Constant-Time Authentication**:
   - All endpoints (except `/api/v1/health`) require `Authorization: Bearer <token>`.
   - Verification uses `crypto.timingSafeEqual` over SHA-256 digests to eliminate timing side-channel attacks.
3. **Input Sanitization**:
   - Agent kind whitelist: `["claude", "codex", "opencode", "cursor", "gemini", "pi"]`.
   - Agent session name regex: `^[a-zA-Z0-9_-]{1,64}$`.
   - Prompt payload ceiling: Maximum 64KB per request.
4. **No Raw Shell Interpolation**:
   - Prompts pass as raw in-memory strings into Herdr PTY bracketed-paste / `agent prompt` API, bypassing shell expansion (`$()`, `&&`, `;`).
5. **Audit Logging**:
   - Every mutating request (`spawn`, `prompt`, `keys`, `close`) is appended to `<state_dir>/audit.log` with timestamp, client IP, target pane, and action.
