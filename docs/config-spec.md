# Configuration Specification — Herdr Agent Gateway

**Deliverable Reference:** DEL-02 (mapped to OpenProject `OP#358`)

---

## 1. Overview

Herdr Agent Gateway supports configuration via:
1. Environment variables & CLI flags (highest precedence)
2. Plugin configuration directory (`~/.config/herdr/plugins/config/herdr-remote-gateway/gateway.env`)
3. Static token file (`~/.config/herdr/plugins/config/herdr-remote-gateway/gateway.token`)
4. Herdr plugin manifest (`herdr-plugin.toml`)

---

## 2. Environment Variables & Defaults

| Variable | Type | Default | Description |
|---|---|---|---|
| `HERDR_GATEWAY_HOST` | String | `127.0.0.1` | IP/Host to bind HTTP listener to. Can be set to `0.0.0.0` when explicitly specified. (Alias: `HERDR_GATEWAY_BIND`). |
| `HERDR_GATEWAY_PORT` | Integer | `9480` | Port to listen on. |
| `HERDR_GATEWAY_TOKEN` | String | *(None)* | Shared Bearer authentication token. Required. |
| `HERDR_GATEWAY_TOKEN_FILE`| String | `.../gateway.token` | Path to file containing Bearer token if not set via env. |
| `HERDR_GATEWAY_DEFAULT_WORKSPACE` | String | `spawned-agents` | Workspace to target if incoming request omits `workspace`. |
| `HERDR_GATEWAY_MAX_PANES` | Integer | `16` | Maximum concurrent active panes before returning `429 Too Many Requests`. |
| `HERDR_PLUGIN_CONFIG_DIR` | String | `~/.config/herdr/plugins/config/herdr-remote-gateway` | Official Herdr plugin config directory. |
| `HERDR_PLUGIN_STATE_DIR` | String | `~/.local/state/herdr/plugins/herdr-remote-gateway` | Official Herdr plugin state directory (`audit.log`). |
| `HERDR_SOCKET_PATH` | String | `~/.config/herdr/herdr.sock` | Path to Herdr Unix domain socket. |
| `HERDR_BIN_PATH` | String | `herdr` | Path to `herdr` executable for CLI fallback. |

---

## 3. Standard Directories (Herdr Official Plugin Conventions)

In accordance with official Herdr plugin architecture:
- **Configuration Directory**:
  `~/.config/herdr/plugins/config/herdr-remote-gateway/`
  (Resolved dynamically via `HERDR_PLUGIN_CONFIG_DIR` or `herdr plugin config-dir herdr-remote-gateway`).
  Contains:
  - `gateway.env`: Service environment variables.
  - `gateway.token`: Bearer token secret file (mode `0600`).
  - `herdr_nodes.json`: Node registry definition and YOLO execution settings.
- **State Directory**:
  `~/.local/state/herdr/plugins/herdr-remote-gateway/`
  (Resolved dynamically via `HERDR_PLUGIN_STATE_DIR`).
  Contains:
  - `audit.log`: Comprehensive append-only audit trail of remote actions.
- **Plugin Root**:
  `plugins/herdr-remote-gateway/` (immutable checkout/linked directory).

---

## 4. Node Registry Discovery & Resolution (`herdr_nodes.json`)

When an agent or client script dispatches an action without an explicit `--node` parameter:

### Resolution Hierarchy:
1. **File Location Priority**:
   - `HERDR_NODES_PATH` (explicit env var or `--nodes-file` flag)
   - `~/.config/herdr/plugins/config/herdr-remote-gateway/herdr_nodes.json` (canonical plugin config)
   - `~/.config/herdr-agent-gateway/herdr_nodes.json` (standalone client config)
   - `~/.config/herdr_nodes.json` (generic fallback)
   - Hardcoded fallback: `http://127.0.0.1:9480`

2. **Node Selection Algorithm**:
   - Step 1: If caller specifies `--node <id>`, use that node directly.
   - Step 2: If `default_node` is defined and passes health check (`/api/v1/health`), use `default_node`.
   - Step 3: If `default_node` is missing or fails health check, iterate through `fallback_order` in sequential order until a responsive node is found.
   - Step 4: If `fallback_order` is not defined, iterate all enabled nodes sorted by ascending `priority`.
   - Step 5: If no nodes respond, exit with descriptive network error code.

### 4.1 YOLO Mode & Approval Mode Configuration

Agent runners support starting agents in non-interactive / YOLO mode (auto-approving commands, skipping permission prompts). These arguments and command overrides are configured inside `herdr_nodes.json`:

- **`yolo_args`**: Maps agent kinds (`pi`, `claude`, `opencode`, `codex`, `dsh`, `antigravity`) to their respective CLI flags:
  ```json
  "yolo_args": {
    "pi": ["--yolo"],
    "claude": ["--dangerously-skip-permissions"],
    "opencode": ["--yolo"],
    "codex": ["--yolo"],
    "dsh": ["--yolo"],
    "antigravity": ["--yolo"]
  }
  ```
- **`yolo_run_commands`**: Optional map of full custom command-line invocations per agent kind when running in YOLO mode.

When calling `/api/v1/agent/start` or `/api/v1/agent/spawn`, setting `approval_mode: "yolo"` (or `"off"`) or `yolo: true` triggers insertion of these YOLO arguments into the launched process invocation.

### Example Configuration:
```json
{
  "$schema": "../../schemas/herdr_nodes.schema.json",
  "default_node": "local-workstation",
  "fallback_order": [
    "local-workstation",
    "lan-desktop",
    "cloud-devbox"
  ],
  "yolo_args": {
    "pi": ["--yolo"],
    "claude": ["--dangerously-skip-permissions"],
    "opencode": ["--yolo"]
  },
  "nodes": {
    "local-workstation": {
      "endpoint": "http://127.0.0.1:9480",
      "auth_token": "env:HERDR_GATEWAY_TOKEN",
      "default_workspace": "spawned-agents",
      "default_agent": "claude",
      "priority": 10
    },
    "lan-desktop": {
      "endpoint": "http://192.168.1.150:9480",
      "auth_token": "env:HERDR_REMOTE_TOKEN",
      "default_workspace": "spawned-agents",
      "default_agent": "codex",
      "priority": 20
    }
  }
}
```

---

## 5. Systemd User Service (`systemd --user`)

Herdr official docs clarify: **`[[startup]]` hooks are one-shot scripts, not supervised daemons**. Therefore, running the gateway as a systemd user service is the recommended, robust pattern on Linux:

```ini
# ~/.config/systemd/user/herdr-agent-gateway.service
[Unit]
Description=Herdr Agent Gateway HTTP Daemon
After=network.target

[Service]
Type=simple
EnvironmentFile=-%h/.config/herdr/plugins/config/herdr-remote-gateway/gateway.env
ExecStart=%h/.nix-profile/bin/bun run %h/Projects/tui/herdr-agent-gateway/plugins/herdr-remote-gateway/src/server.ts
Restart=on-failure
RestartSec=3s

[Install]
WantedBy=default.target
```
