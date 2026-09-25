# Herdr Agent Gateway — Hermes Plugin Installed! 🚀

The **Herdr** multi-machine plugin is now installed in your Hermes environment.

## 📦 Prerequisites: Herdr CLI

This plugin interacts directly with the `herdr` CLI on the host system or inside the container to coordinate across local and remote SSH machines.

- **Check if Herdr is installed**:
  ```bash
  herdr --version
  ```
- **If Herdr is not installed**:
  - **Linux / macOS**:
    ```bash
    curl -fsSL https://herdr.dev/install | sh
    ```
    (Installs to `~/.local/bin/herdr`.)
  - **NixOS / Containers**:
    Mount `herdr` into the container via `hermesContainerTools` or add `pkgs.herdr` to your environment.
  - **Custom Binary Path**:
    Set the `HERDR_BIN_PATH` environment variable if `herdr` is installed in a non-standard location.

---

## 🛠️ Provided Tools

1. **`herdr_list_machines`**:
   List all local and saved SSH machines configured in Herdr (`herdr machine list --json`).

2. **`herdr_list_agents`**:
   List active AI coding agents running in Herdr across all connected machines (or on a specific machine).

3. **`herdr_spawn_agent`**:
   Request a pane split and launch an AI coding agent (`claude`, `codex`, `opencode`, `hermes`, `pi`, `cursor`) on any local or remote machine with an execution prompt:
   ```json
   {
     "prompt": "Investigate the memory leak in auth service",
     "machine": "pikujs-server-1",
     "kind": "claude",
     "pane_direction": "right"
   }
   ```

4. **`herdr_prompt_agent`**:
   Send follow-up prompts or instructions to an active agent session in Herdr.

5. **`herdr_read_agent`**:
   Read recent terminal output from an active agent session.

6. **`herdr_node_status`**:
   Check server status and health of a local or remote Herdr host.

---

## 💬 Slash Commands

- `/herdr machines`: List connected local and remote SSH machines
- `/herdr agents [machine]`: List active agents across machines
- `/herdr status [machine]`: Inspect health of a Herdr server
- `/herdr spawn <prompt>`: Quick agent spawn in Herdr

---

## 🌐 Connecting Remote Machines

To add remote machines for Herdr to coordinate with over SSH:
```bash
herdr machine add user@remote-host --label "Remote Server"
```
Once added, all tools and slash commands can immediately target that machine via `"machine": "Remote Server"`.
