---
name: herdr-agent-gateway
description: Discover, inspect, and orchestrate AI coding agents (Pi, Claude Code, OpenCode, Codex, Cursor) across local and remote machines in the Herdr terminal multiplexer fleet.
---

# Herdr Agent Gateway Skill

Use this skill when you need to inspect running agents across the machine network, delegate tasks to sub-agents on specific machines, spawn dedicated terminal panes, or communicate with active agents in **Herdr**.

The gateway provides a single unified CLI executable: `herdr-agent-gateway`.

---

## 🧭 1. Discovering Fleet Machines

List all available machines in the cluster (local workstation and remote SSH nodes):

```bash
herdr-agent-gateway machines
```

For structured JSON:
```bash
herdr-agent-gateway machines --json
```

Example JSON response:
```json
[
  {
    "id": "local",
    "label": "local",
    "target": "localhost",
    "enabled": true
  },
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

To probe live reachability:
```bash
herdr-agent-gateway machines --probe
```

---

## 🔍 2. Fleet-Wide Agent Overview

To see all running agents across the entire fleet with rich metadata (machine, agent kind, lifecycle status, workspace, window title, working directory, and task description):

```bash
herdr-agent-gateway overview
```

With task descriptions and pane IDs:
```bash
herdr-agent-gateway overview -d
```

As structured JSON for programmatic inspection:
```bash
herdr-agent-gateway overview --json
```

Filter by a specific machine:
```bash
herdr-agent-gateway overview --machine pikujs-server-1 --json
```

### Understanding Agent States:
- `idle`: Agent has finished its last task and is waiting for user input.
- `working` / `running`: Agent is currently generating code, running commands, or thinking.
- `blocked` / `attention`: Agent is paused waiting for permission or confirmation.

---

## 🚀 3. Spawning Agents

Split a terminal pane and launch an agent on `local` or any remote machine:

```bash
# Spawn a Pi agent on the local workstation
herdr-agent-gateway spawn --kind pi --name my-feature-agent --cwd /home/pikujs/Projects/my-app

# Spawn a Claude Code agent on a remote server
herdr-agent-gateway spawn --kind claude --name api-refactor --machine pikujs-server-1 --cwd /srv/projects/api

# Spawn an agent with an initial prompt and wait for it to settle into idle:
herdr-agent-gateway spawn \
  --kind pi \
  --name doc-updater \
  --machine pikujs-predator \
  --cwd /home/pikujs/Projects/docs \
  --prompt "Read README.md and update installation instructions" \
  --wait
```

### Supported Agent Kinds:
- `pi`: Pi Coding Agent
- `claude`: Anthropic Claude Code CLI
- `opencode`: OpenCode CLI
- `codex`: OpenAI Codex CLI
- `gemini`: Gemini CLI
- `cursor`: Cursor Agent CLI

---

## 💬 4. Communicating with Active Agents

### Injecting a Prompt into an Agent:
Send a follow-up task or instruction to an agent in a running pane:

```bash
herdr-agent-gateway prompt my-feature-agent "Now run unit tests and fix any failures"

# On a remote machine, blocking until the agent finishes:
herdr-agent-gateway prompt api-refactor "Deploy to staging" --machine pikujs-server-1 --wait
```

### Reading Agent Output:
Read recent terminal screen buffer or scrollback from an agent pane:

```bash
# Read the last 50 lines from an agent
herdr-agent-gateway read my-feature-agent --lines 50

# Read output from a remote machine:
herdr-agent-gateway read api-refactor --machine pikujs-server-1 --lines 100
```

---

## 🏥 5. Checking Daemon Health

Check Herdr server daemon status and protocol version:

```bash
# Local daemon status
herdr-agent-gateway status

# Remote machine daemon status
herdr-agent-gateway status --machine pikujs-server-1
```

---

## 💡 Best Practices for Coordinating Agents
1. **Always check `overview` first**: Check if an agent is already active in your target repository before spawning a new one.
2. **Use `--wait` for sequential workflows**: When one agent's output is needed for the next step, pass `--wait` to ensure it returns to `idle`.
3. **Inspect with `read` before interrupting**: If an agent appears stuck, use `read` to check its screen output before sending new keys or prompts.
