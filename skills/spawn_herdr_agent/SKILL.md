---
name: spawn-herdr-agent
description: Control Herdr terminal multiplexer, inspect active agents and their working directories across machines, split panes, and spawn coding agent sessions (Claude Code, OpenCode, Pi, Codex, Cursor, Hermes) across local and remote SSH machines.
---

# spawn-herdr-agent — Herdr Multi-Machine Dispatch Skill

Use this skill when you need to delegate coding tasks, run long builds or tests in a dedicated terminal pane, or coordinate with AI agents across local and remote developer machines running **Herdr**.

---

## 🎯 Architecture: Native Herdr Multi-Machine Coordination

Herdr v0.9.1+ natively supports multi-machine coordination over encrypted OpenSSH bridges using its JSON socket API:
- **No HTTP daemon / custom port**: All communication travels through Herdr's native CLI and SSH multiplexing.
- **Unified `--machine` flag**: Any Herdr API command (`agent`, `pane`, `workspace`, `worktree`, `status`) accepts `--machine <label-or-id>` to target any connected host transparently.
- **Native Agent Lifecycle & Directory Tracking**: Herdr continuously monitors each pane's working directory (`cwd` and `foreground_cwd`), agent kind (`pi`, `claude`, `codex`, `opencode`, `hermes`, etc.), and agent state (`idle`, `running`, `attention`).

---

## 🧭 Machine Discovery

List all local and saved SSH machines configured in Herdr:
```bash
herdr machine list --json
```

Output format:
```json
[
  {
    "id": "fd6d5da9232f93b31ced741382542051",
    "label": "pikujs-server-1",
    "target": "pikujs@pikujs-server-1.local",
    "session": "default",
    "enabled": true
  },
  {
    "id": "e2f515000addf5402cd693dc96135ae9",
    "label": "pikujs-predator",
    "target": "pikujs@pikujs-predator.local",
    "session": "default",
    "enabled": true
  }
]
```

To add a new remote SSH machine:
```bash
herdr machine add user@hostname --label "Server 1"
```

---

## 📂 Inspecting Agent Directories & Active Agents

Before spawning a new agent, check if an agent is already working in the target project directory. Herdr tracks both `cwd` (the shell launch directory) and `foreground_cwd` (the active process working directory).

### Cluster-Wide Overview (Including Working Directory)
Run the overview CLI to see all running agents, their machine, state, and active directory:
```bash
agent-spawn-remote list agents
# Or directly via Python:
python3 /path/to/herdr-agent-gateway/bin/agents-overview.py
```

Output example:
```
══ Herdr Multi-Machine Agent Overview ══

MACHINE            KIND       STATUS       PANE       WORKSPACE    CWD
──────────────────────────────────────────────────────────────────────────────────────────
local              pi         idle         wM:p4      wM           /home/pikujs/Projects/ext/ai/agents/dsh/cordis
local              pi         idle         w0:pV      w0           /home/pikujs/Projects/nixos-server-config
local              pi         idle         w1A:p1     w1A          /home/pikujs/Projects/ai/agents/dotagents
pikujs-server-1    claude     idle         w0:p2      w0           /srv/projects/auth-service
```

### JSON Inspection & Directory Filtering
To query agents programmatically and filter by project directory:
```bash
# Query JSON of agents on local machine
herdr agent list

# Query JSON of agents on a remote machine
herdr --machine "pikujs-server-1" agent list

# Filter agents currently in a specific directory:
herdr agent list | jq '.result.agents[] | select(.cwd == "/home/pikujs/Projects/nixos-server-config")'
```

Each agent object provides:
- **`cwd`**: Absolute filesystem path where the agent was launched.
- **`foreground_cwd`**: Current working directory of the foreground process.
- **`pane_id`**: Pane identifier (e.g. `w0:p2`).
- **`agent`**: Agent kind (`pi`, `claude`, `codex`, `opencode`, `hermes`, etc.).
- **`agent_status`**: Current lifecycle state (`idle`, `running`, `attention`).
- **`terminal_title`**: Window title reported by the shell or agent.

---

## 🚀 Spawning & Controlling Agents in a Directory

### 1. Split a Pane in the Desired Directory
Always specify `--cwd` so the agent starts directly in the project workspace:
```bash
# Local machine
herdr pane split --direction right --cwd /home/pikujs/Projects/my-app

# Remote machine
herdr --machine "pikujs-server-1" pane split --direction right --cwd /srv/projects/my-app
```
The command outputs the new `pane_id` (e.g. `w0:p3`).

### 2. Start an Agent
Start the agent in the allocated pane:
```bash
# Local
herdr agent start worker-1 --kind claude --pane w0:p3

# Remote
herdr --machine "pikujs-server-1" agent start worker-1 --kind claude --pane w0:p3
```
Supported kinds: `claude`, `codex`, `opencode`, `hermes`, `pi`, `gemini`, `cursor`, `devin`, `agy`.

### 3. Prompt the Agent
Inject task instructions into the agent PTY:
```bash
# Inject prompt and return immediately
herdr --machine "pikujs-server-1" agent prompt worker-1 "Investigate memory leak in auth service"

# Inject prompt and wait for agent to return to idle
herdr --machine "pikujs-server-1" agent prompt worker-1 "Run test suite and fix failures" --wait
```

### 4. Read Output & Monitor
Read the latest terminal output from the agent:
```bash
herdr --machine "pikujs-server-1" agent read worker-1 --lines 100 --source recent-unwrapped
```

### 5. Send Keystrokes or Terminate
```bash
# Send Ctrl+C
herdr --machine "pikujs-server-1" agent send-keys worker-1 ctrl+c

# Close agent pane
herdr --machine "pikujs-server-1" pane close w0:p3
```

---

## 📦 Using `agent-spawn-remote` with Directory Support

For quick one-liner execution from shell scripts or agent prompts:
```bash
# Spawn agent on remote machine in a specific project directory
agent-spawn-remote spawn \
  --machine pikujs-server-1 \
  --cwd /srv/projects/auth-service \
  --kind claude \
  --name auth-refactor \
  --prompt "Refactor database pool connection handling" \
  --wait

# Inspect agents and their directories
agent-spawn-remote list agents
```
