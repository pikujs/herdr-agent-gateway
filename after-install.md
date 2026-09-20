# Herdr Agent Gateway — Hermes Plugin Installed! 🚀

The **Herdr** plugin is now installed in your Hermes environment.

## 🛠️ Provided Tools

1. **`herdr_spawn_agent`**:
   Request a new pane split in Herdr on any configured workstation or server, launching an agent session (Claude Code, OpenCode, Codex, Cursor, or Hermes) with an initial prompt.
   ```json
   {
     "prompt": "Investigate the memory leak in auth service",
     "node": "pikujs-mini",
     "kind": "claude",
     "pane_direction": "right"
   }
   ```

2. **`herdr_list_nodes`**:
   List all available Herdr nodes defined in `~/.config/herdr_nodes.json`. Pass `"check_health": true` to ping their status.

3. **`herdr_node_status`**:
   Check health, version, and active pane count for a specific Herdr node.

## 💬 Slash Commands

- `/herdr list`: List configured nodes
- `/herdr status [node]`: Inspect health of a Herdr gateway node
- `/herdr spawn [prompt]`: Quick agent spawn in local/default Herdr

## ⚙️ Configuration

The plugin reads node definitions from `~/.config/herdr_nodes.json`. Example:

```json
{
  "default_node": "localhost",
  "nodes": {
    "localhost": {
      "url": "http://127.0.0.1:9480",
      "token": "YOUR_SHARED_SECRET_TOKEN"
    },
    "pikujs-mini": {
      "url": "http://192.168.88.15:9480",
      "token": "YOUR_SHARED_SECRET_TOKEN"
    }
  }
}
```

If `~/.config/herdr_nodes.json` does not exist, the plugin falls back to:
- `HERDR_GATEWAY_URL` (default: `http://127.0.0.1:9480`)
- `HERDR_GATEWAY_TOKEN` (Bearer token)
