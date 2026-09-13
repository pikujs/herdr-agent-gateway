import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function expandHome(filepath: string): string {
  if (filepath.startsWith("~/") || filepath === "~") {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

export interface GatewayConfig {
  host: string;
  port: number;
  token?: string;
  tokenFile: string;
  defaultWorkspace: string;
  maxPanes: number;
  configDir: string;
  stateDir: string;
  auditLogPath: string;
  socketPath: string;
  binPath: string;
  authorizedKeysPaths: string[];
  yoloArgs: Record<string, string[]>;
  tlsCert?: string;
  tlsKey?: string;
}

export function loadEnvFile(envPath: string): void {
  const resolved = expandHome(envPath);
  if (!fs.existsSync(resolved)) return;
  try {
    const content = fs.readFileSync(resolved, "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) {
          process.env[key] = val.replace(/^["']|["']$/g, "");
        }
      }
    }
  } catch (err) {
    console.error(`[config] Failed to read env file ${resolved}:`, err);
  }
}

export function resolveConfig(): GatewayConfig {
  const configDir = expandHome(
    process.env.HERDR_PLUGIN_CONFIG_DIR ??
      path.join(os.homedir(), ".config", "herdr", "plugins", "config", "herdr-remote-gateway")
  );

  // Load gateway.env from plugin config directory if present
  loadEnvFile(path.join(configDir, "gateway.env"));

  const stateDir = expandHome(
    process.env.HERDR_PLUGIN_STATE_DIR ??
      path.join(os.homedir(), ".local", "state", "herdr", "plugins", "herdr-remote-gateway")
  );

  const tokenFile = expandHome(
    process.env.HERDR_GATEWAY_TOKEN_FILE ?? path.join(configDir, "gateway.token")
  );

  let token = process.env.HERDR_GATEWAY_TOKEN;
  if (!token && fs.existsSync(tokenFile)) {
    try {
      token = fs.readFileSync(tokenFile, "utf8").trim();
    } catch {}
  }

  const host = process.env.HERDR_GATEWAY_HOST ?? process.env.HERDR_GATEWAY_BIND ?? "127.0.0.1";
  const port = parseInt(process.env.HERDR_GATEWAY_PORT ?? "9480", 10);
  const defaultWorkspace = process.env.HERDR_GATEWAY_DEFAULT_WORKSPACE ?? "spawned-agents";
  const maxPanes = parseInt(process.env.HERDR_GATEWAY_MAX_PANES ?? "16", 10);
  const socketPath = expandHome(
    process.env.HERDR_SOCKET_PATH ?? path.join(os.homedir(), ".config", "herdr", "herdr.sock")
  );
  const binPath = process.env.HERDR_BIN_PATH ?? "herdr";

  const authorizedKeysPaths = [
    path.join(configDir, "authorized_keys"),
    path.join(os.homedir(), ".ssh", "authorized_keys"),
  ];

  // Resolve YOLO arguments per agent kind (merge defaults with herdr_nodes.json config)
  const yoloArgs: Record<string, string[]> = { ...DEFAULT_AGENT_YOLO_ARGS };

  // Check herdr_nodes.json in configDir or standard paths
  const nodesCandidatePaths = [
    path.join(configDir, "herdr_nodes.json"),
    expandHome("~/.config/herdr-agent-gateway/herdr_nodes.json"),
    expandHome("~/.config/herdr_nodes.json"),
    path.join(configDir, "agent_nodes.json"),
    expandHome("~/.config/herdr-agent-gateway/agent_nodes.json"),
    expandHome("~/.config/agent_nodes.json"),
  ];
  for (const nPath of nodesCandidatePaths) {
    if (fs.existsSync(nPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(nPath, "utf8"));
        if (parsed.yolo_run_commands && typeof parsed.yolo_run_commands === "object") {
          for (const [k, v] of Object.entries(parsed.yolo_run_commands)) {
            yoloArgs[k.toLowerCase()] = Array.isArray(v) ? (v as string[]) : [String(v)];
          }
        }
        // Also check default node specific yolo_args
        const defNode = parsed.default_node && parsed.nodes ? parsed.nodes[parsed.default_node] : null;
        if (defNode && defNode.yolo_args && typeof defNode.yolo_args === "object") {
          for (const [k, v] of Object.entries(defNode.yolo_args)) {
            yoloArgs[k.toLowerCase()] = Array.isArray(v) ? (v as string[]) : [String(v)];
          }
        }
        break;
      } catch {}
    }
  }

  return {
    host,
    port,
    token,
    tokenFile,
    defaultWorkspace,
    maxPanes,
    configDir,
    stateDir,
    auditLogPath: path.join(stateDir, "audit.log"),
    socketPath,
    binPath,
    authorizedKeysPaths,
    yoloArgs,
    tlsCert: process.env.HERDR_GATEWAY_TLS_CERT ? expandHome(process.env.HERDR_GATEWAY_TLS_CERT) : undefined,
    tlsKey: process.env.HERDR_GATEWAY_TLS_KEY ? expandHome(process.env.HERDR_GATEWAY_TLS_KEY) : undefined,
  };
}

/** Canonical mapping from user input agent aliases to Herdr agent kinds */
export const AGENT_KIND_MAP: Record<string, string> = {
  opencode: "opencode",
  pi: "pi",
  dsh: "pi",
  "dsh-cordis": "pi",
  claude: "claude",
  "claude-code": "claude",
  antigravity: "agy",
  agy: "agy",
  codex: "codex",
  cursor: "cursor",
  gemini: "gemini",
  copilot: "copilot",
  droid: "droid",
  qwen: "qwen",
};

export function normalizeAgentKind(kind: string): string | null {
  const lower = kind.trim().toLowerCase();
  return AGENT_KIND_MAP[lower] ?? null;
}

/** Default YOLO run arguments per agent kind */
export const DEFAULT_AGENT_YOLO_ARGS: Record<string, string[]> = {
  pi: ["--yolo"],
  opencode: ["--yolo"],
  claude: ["--dangerously-skip-permissions"],
  "claude-code": ["--dangerously-skip-permissions"],
  codex: ["--yolo"],
  cursor: ["--yolo"],
  gemini: ["--yolo"],
  agy: ["--yolo"],
  antigravity: ["--yolo"],
  dsh: ["--yolo"],
  "dsh-cordis": ["--yolo"],
};

export function resolveAgentYoloArgs(kind: string, customConfig?: Record<string, string[]>): string[] {
  const normalized = normalizeAgentKind(kind) ?? kind.trim().toLowerCase();
  const lower = kind.trim().toLowerCase();
  if (customConfig && customConfig[normalized]) {
    return customConfig[normalized];
  }
  if (customConfig && customConfig[lower]) {
    return customConfig[lower];
  }
  return (
    DEFAULT_AGENT_YOLO_ARGS[normalized] ??
    DEFAULT_AGENT_YOLO_ARGS[lower] ??
    ["--yolo"]
  );
}
