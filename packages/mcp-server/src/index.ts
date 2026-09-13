import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

function expandHome(filepath: string): string {
  if (filepath.startsWith("~/") || filepath === "~") {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

interface NodeConfig {
  endpoint: string;
  auth_token?: string;
  ssh_key?: { private_key_path?: string };
}

function resolveNodeEndpoint(): { endpoint: string; token?: string; sshKeyPath?: string } {
  // Direct environment variable overrides
  if (process.env.HERDR_GATEWAY_ENDPOINT) {
    return {
      endpoint: process.env.HERDR_GATEWAY_ENDPOINT.replace(/\/$/, ""),
      token: process.env.HERDR_GATEWAY_TOKEN,
      sshKeyPath: process.env.HERDR_SSH_KEY ? expandHome(process.env.HERDR_SSH_KEY) : undefined,
    };
  }

  const candidatePaths = [
    process.env.HERDR_NODES_PATH ? expandHome(process.env.HERDR_NODES_PATH) : "",
    process.env.HERDR_AGENT_NODES_PATH ? expandHome(process.env.HERDR_AGENT_NODES_PATH) : "",
    path.join(os.homedir(), ".config", "herdr", "plugins", "config", "herdr-remote-gateway", "herdr_nodes.json"),
    path.join(os.homedir(), ".config", "herdr-agent-gateway", "herdr_nodes.json"),
    path.join(os.homedir(), ".config", "herdr_nodes.json"),
    path.join(os.homedir(), ".config", "herdr", "plugins", "config", "herdr-remote-gateway", "agent_nodes.json"),
    path.join(os.homedir(), ".config", "herdr-agent-gateway", "agent_nodes.json"),
    path.join(os.homedir(), ".config", "agent_nodes.json"),
  ].filter(Boolean);

  let registry: any = null;
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        registry = JSON.parse(fs.readFileSync(p, "utf8"));
        break;
      } catch {}
    }
  }

  if (!registry || !registry.nodes) {
    const tokenFile = path.join(
      os.homedir(),
      ".config",
      "herdr",
      "plugins",
      "config",
      "herdr-remote-gateway",
      "gateway.token"
    );
    let token = process.env.HERDR_GATEWAY_TOKEN;
    if (!token && fs.existsSync(tokenFile)) {
      token = fs.readFileSync(tokenFile, "utf8").trim();
    }
    return { endpoint: "http://127.0.0.1:9480", token };
  }

  const targetNodeId = registry.default_node || (registry.fallback_order && registry.fallback_order[0]) || Object.keys(registry.nodes)[0];
  const node: NodeConfig = registry.nodes[targetNodeId] || { endpoint: "http://127.0.0.1:9480" };

  let token = node.auth_token;
  if (token?.startsWith("env:")) {
    const envVar = token.slice(4);
    token = process.env[envVar];
  }

  return {
    endpoint: node.endpoint.replace(/\/$/, ""),
    token,
    sshKeyPath: node.ssh_key?.private_key_path ? expandHome(node.ssh_key.private_key_path) : undefined,
  };
}

const nodeTarget = resolveNodeEndpoint();

async function gatewayFetch(pathUrl: string, method = "GET", body?: any): Promise<any> {
  const url = `${nodeTarget.endpoint}${pathUrl}`;
  const bodyText = body ? JSON.stringify(body) : "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (nodeTarget.token) {
    headers["Authorization"] = `Bearer ${nodeTarget.token}`;
  } else if (nodeTarget.sshKeyPath && fs.existsSync(nodeTarget.sshKeyPath)) {
    const timestamp = new Date().toISOString();
    const digest = crypto.createHash("sha256").update(bodyText).digest("base64");
    const canonical = `${method.toUpperCase()}\n${pathUrl.split("?")[0]}\n${timestamp}\n${digest}`;
    const privKey = fs.readFileSync(nodeTarget.sshKeyPath, "utf8");
    const sig = crypto.sign(null, Buffer.from(canonical, "utf8"), privKey).toString("base64");

    headers["X-Herdr-Timestamp"] = timestamp;
    headers["X-Herdr-Digest"] = `SHA-256=${digest}`;
    headers["X-Herdr-Signature"] = sig;
    headers["Authorization"] = `SSH-Signature timestamp="${timestamp}",signature="${sig}"`;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? bodyText : undefined,
  });

  const json: any = await res.json();
  if (!res.ok) {
    throw new Error(`Gateway Error (${res.status}): ${json.error || JSON.stringify(json)}`);
  }
  return json;
}

const server = new Server(
  {
    name: "herdr-agent-gateway-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define tool schemas
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Tier 1: Read & Introspect
      {
        name: "herdr_health",
        description: "Check connectivity to the Herdr Agent Gateway and multiplexer daemon.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "herdr_list_workspaces",
        description: "List all active workspaces and their summaries in Herdr.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "herdr_list_panes",
        description: "List all terminal panes, current agents, and layout status.",
        inputSchema: {
          type: "object",
          properties: {
            workspace_id: { type: "string", description: "Optional workspace filter ID" },
          },
        },
      },
      {
        name: "herdr_list_agents",
        description: "List running AI coding agents and their live states (idle, working, blocked, done).",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "herdr_read_pane_output",
        description: "Read terminal scrollback or recent output from a specific pane.",
        inputSchema: {
          type: "object",
          required: ["pane_id"],
          properties: {
            pane_id: { type: "string", description: "Pane handle (e.g. 'w1:p2')" },
            lines: { type: "number", default: 100, description: "Number of rows to fetch" },
            format: { type: "string", enum: ["text", "ansi"], default: "text" },
          },
        },
      },

      // Tier 2: Mutate & Create
      {
        name: "herdr_spawn_agent",
        description: "Create a new terminal tab in a workspace, initialize a coding agent (OpenCode, Pi, Claude Code, Antigravity, etc.), and deliver initial prompt.",
        inputSchema: {
          type: "object",
          required: ["agent_name", "agent_kind"],
          properties: {
            agent_name: {
              type: "string",
              description: "Unique alphanumeric session name (regex: ^[a-zA-Z0-9_-]{1,64}$)",
            },
            agent_kind: {
              type: "string",
              enum: ["opencode", "pi", "dsh", "claude", "claude-code", "antigravity", "agy", "codex", "cursor", "gemini"],
              description: "Supported agent kind",
            },
            prompt: {
              type: "string",
              description: "Initial task prompt or instructions to execute",
            },
            workspace: {
              type: "string",
              description: "Workspace to target (defaults to 'spawned-agents')",
            },
            direction: {
              type: "string",
              enum: ["right", "down"],
              default: "right",
              description: "Split orientation",
            },
            cwd: {
              type: "string",
              description: "Working directory path on the workstation",
            },
            approval_mode: {
              type: "string",
              enum: ["prompt", "yolo", "off", "default"],
              default: "prompt",
              description: "Approval mode for agent execution. When set to 'yolo' or 'off', runs the agent in auto-approved YOLO mode.",
            },
            agent_args: {
              type: "array",
              items: { type: "string" },
              description: "Optional custom CLI arguments to pass to the launched agent process.",
            },
            sync: {
              type: "boolean",
              default: true,
              description: "Whether to wait for prompt settlement before returning",
            },
          },
        },
      },
      {
        name: "herdr_prompt_agent",
        description: "Submit a new prompt or instruction to an existing active agent session.",
        inputSchema: {
          type: "object",
          required: ["agent_name", "prompt"],
          properties: {
            agent_name: { type: "string", description: "Agent handle or name" },
            prompt: { type: "string", description: "Prompt text to inject" },
            wait: { type: "boolean", default: false, description: "Wait for response completion" },
          },
        },
      },

      // Tier 3: Direct Control & Teardown
      {
        name: "herdr_send_keys",
        description: "Send key presses or control sequences to a terminal pane (e.g. 'ctrl+c', 'esc', 'enter').",
        inputSchema: {
          type: "object",
          required: ["pane_id", "keys"],
          properties: {
            pane_id: { type: "string", description: "Target pane ID" },
            keys: {
              type: "array",
              items: { type: "string" },
              description: "List of key names (e.g. ['ctrl+c'])",
            },
          },
        },
      },
      {
        name: "herdr_close_pane",
        description: "Gracefully close and terminate a terminal pane.",
        inputSchema: {
          type: "object",
          required: ["pane_id"],
          properties: {
            pane_id: { type: "string", description: "Pane ID to close" },
          },
        },
      },
    ],
  };
});

// Handle tool executions
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    let resultData: any;

    switch (name) {
      case "herdr_health": {
        resultData = await gatewayFetch("/api/v1/health");
        break;
      }
      case "herdr_list_workspaces": {
        const snapshot = await gatewayFetch("/api/v1/snapshot");
        resultData = snapshot?.result?.workspaces ?? snapshot?.workspaces ?? [];
        break;
      }
      case "herdr_list_panes": {
        const snapshot = await gatewayFetch("/api/v1/snapshot");
        resultData = snapshot?.result?.panes ?? snapshot?.panes ?? [];
        break;
      }
      case "herdr_list_agents": {
        const snapshot = await gatewayFetch("/api/v1/snapshot");
        resultData = snapshot?.result?.agents ?? snapshot?.agents ?? [];
        break;
      }
      case "herdr_read_pane_output": {
        const paneId = encodeURIComponent(String(args.pane_id));
        const lines = args.lines ?? 100;
        const format = args.format ?? "text";
        resultData = await gatewayFetch(`/api/v1/panes/${paneId}?lines=${lines}&format=${format}`);
        break;
      }
      case "herdr_spawn_agent": {
        const syncParam = args.sync !== false ? "true" : "false";
        resultData = await gatewayFetch(`/api/v1/agents/spawn?sync=${syncParam}`, "POST", {
          agent_name: args.agent_name,
          agent_kind: args.agent_kind,
          prompt: args.prompt,
          workspace: args.workspace,
          direction: args.direction ?? "right",
          cwd: args.cwd,
          focus: false,
          approval_mode: args.approval_mode,
          agent_args: args.agent_args,
        });
        break;
      }
      case "herdr_prompt_agent": {
        resultData = await gatewayFetch("/api/v1/agents/prompt", "POST", {
          agent_name: args.agent_name,
          prompt: args.prompt,
          wait: args.wait ?? false,
        });
        break;
      }
      case "herdr_send_keys": {
        const paneId = encodeURIComponent(String(args.pane_id));
        resultData = await gatewayFetch(`/api/v1/panes/${paneId}/keys`, "POST", {
          keys: args.keys,
        });
        break;
      }
      case "herdr_close_pane": {
        const paneId = encodeURIComponent(String(args.pane_id));
        resultData = await gatewayFetch(`/api/v1/panes/${paneId}/close`, "POST", {});
        break;
      }
      default:
        throw new Error(`Unknown tool name: ${name}`);
    }

    return {
      content: [
        {
          type: "text",
          text: typeof resultData === "string" ? resultData : JSON.stringify(resultData, null, 2),
        },
      ],
    };
  } catch (err: any) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Tool Execution Error (${name}): ${err.message}`,
        },
      ],
    };
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[herdr-mcp-server] MCP Server connected via Stdio");
}

runServer().catch((err) => {
  console.error("[herdr-mcp-server] Fatal startup error:", err);
  process.exit(1);
});
