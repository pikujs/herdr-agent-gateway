# Master Implementation Plan — Herdr Agent Gateway

**Tracked Work Package:** OpenProject OP#358 (`pikujs-server`)

---

## 1. Deliverables Tracking

| ID | Deliverable | Location | Status |
|---|---|---|---|
| **DEL-01** | Gateway Daemon & Herdr IPC | `plugins/herdr-remote-gateway/` | 🟢 Completed |
| **DEL-02** | Configuration Specification | `docs/config-spec.md` | 🟢 Completed |
| **DEL-03** | Machine Registry Schema | `schemas/herdr_nodes.schema.json` | 🟢 Completed |
| **DEL-04** | Dispatcher CLI Script | `scripts/agent-spawn-remote` | 🟢 Completed |
| **DEL-05** | Agent Skill & MCP Server | `skills/spawn_herdr_agent/` & `packages/mcp-server/` | 🟢 Completed |

---

## 2. Phase-by-Phase Roadmap

### Phase 1: Core Gateway Daemon & Herdr Socket Client (`plugins/herdr-remote-gateway`)
- **Package Setup**: `package.json`, `tsconfig.json` using Bun runtime.
- **Herdr Socket Client (`src/herdr/socket.ts`)**:
  - Direct connection to `~/.config/herdr/herdr.sock` using newline-delimited JSON-RPC.
  - Sub-15ms request framing and timeout handling.
  - Automatic fallback to `herdr` CLI (`src/herdr/cli_fallback.ts`) if socket fails.
- **HTTP Server (`src/server.ts`)**:
  - Fast HTTP server using `Bun.serve`.
  - Constant-time Bearer token verification (`crypto.timingSafeEqual`).
  - Network binding validation: defaults to `127.0.0.1`, allows `0.0.0.0` only when explicitly set in `HERDR_GATEWAY_BIND`.
  - Route handlers: `/api/v1/health`, `/api/v1/snapshot`, `/api/v1/agents/spawn`, `/api/v1/agents/prompt`, `/api/v1/panes/*`.
  - Synchronous vs. asynchronous spawn parameter (`?sync=true|false`).
  - Dedicated `"spawned-agents"` workspace fallback policy.
  - Audit logging appended to `<state_dir>/audit.log`.

### Phase 2: Herdr Plugin Manifest & Systemd Supervision
- **Manifest (`herdr-plugin.toml`)**:
  - Registered actions: `setup`, `status`, `restart`.
  - Optional `[[startup]]` configuration for zero-systemd environments.
- **CLI Helper (`src/cli.ts`)**:
  - `bun src/cli.ts setup`: generates and installs `~/.config/systemd/user/herdr-agent-gateway.service`.
  - `bun src/cli.ts status`: queries daemon `/health` and systemd unit status.
  - `bun src/cli.ts restart`: triggers service restart.

### Phase 3: Client CLI Script (`scripts/agent-spawn-remote`)
- Portable POSIX bash script using `curl` and `jq`.
- Resolves machine profiles from `~/.config/herdr/plugins/config/herdr-remote-gateway/herdr_nodes.json` (or default localhost).
- Subcommands structured for permission systems:
  - `list` (workspaces, panes, agents)
  - `read` (pane scrollback)
  - `spawn` (split and launch agent)
  - `prompt` (inject instruction)
  - `keys` (send keys)
  - `close` (close pane)
- Proper exit code mapping: 0 (success), 1 (network/auth failure), 2 (bad request/invalid parameters), 3 (herdr error).

### Phase 4: Agent Skill & Model Context Protocol (MCP) Server
- **Agent Skill (`skills/spawn_herdr_agent/SKILL.md`)**:
  - Detailed tool and skill documentation for Claude Code, OpenCode, and Antigravity.
- **MCP Server (`packages/mcp-server/`)**:
  - Built with TypeScript and `@modelcontextprotocol/sdk`.
  - Exposes granular tools:
    - Tier 1: `herdr_list_workspaces`, `herdr_list_panes`, `herdr_list_agents`, `herdr_read_pane_output`.
    - Tier 2: `herdr_spawn_agent`, `herdr_prompt_agent`.
    - Tier 3: `herdr_send_keys`, `herdr_close_pane`.
  - Compatible with Claude Code MCP config, Cursor, Antigravity, and OpenCode.

### Phase 5: Verification, Integration Testing & OP#358 Sync
- Run automated unit tests (`bun test`).
- Test split pane and agent startup inside active Herdr session.
- Verify that keyboard focus is not stolen.
- Test audit log generation.
- Update OpenProject task OP#358 status and comments.
