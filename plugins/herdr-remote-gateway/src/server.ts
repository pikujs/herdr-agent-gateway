import fs from "node:fs";
import { resolveConfig, normalizeAgentKind, AGENT_KIND_MAP, type GatewayConfig } from "./config";
import { authenticateRequest } from "./auth";
import { AuditLogger } from "./audit";
import { HerdrClient } from "./herdr/client";

const config = resolveConfig();
const audit = new AuditLogger(config.auditLogPath);
const herdr = new HerdrClient(config.socketPath, config.binPath, config.defaultWorkspace);

// Simple in-memory sliding window rate limiter
const rateLimitWindowMs = 60_000;
const maxRequestsPerWindow = 60;
const requestCounts = new Map<string, { count: number; expiresAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = requestCounts.get(ip);
  if (!record || now > record.expiresAt) {
    requestCounts.set(ip, { count: 1, expiresAt: now + rateLimitWindowMs });
    return true;
  }
  if (record.count >= maxRequestsPerWindow) {
    return false;
  }
  record.count++;
  return true;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2) + "\n", {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(message: string, code: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return jsonResponse({ error: message, code, ...extra }, status);
}

const NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

export function createServer(customConfig?: Partial<GatewayConfig>) {
  const cfg = { ...config, ...customConfig };

  const server = Bun.serve({
    hostname: cfg.host,
    port: cfg.port,
    tls:
      cfg.tlsCert && cfg.tlsKey && fs.existsSync(cfg.tlsCert) && fs.existsSync(cfg.tlsKey)
        ? {
            cert: Bun.file(cfg.tlsCert),
            key: Bun.file(cfg.tlsKey),
          }
        : undefined,

    async fetch(req, server) {
      const url = new URL(req.url);
      const clientIp = server.requestIP(req)?.address ?? "127.0.0.1";

      // 1. Rate Limiting
      if (!checkRateLimit(clientIp)) {
        return errorResponse("Rate limit exceeded", "RATE_LIMIT_EXCEEDED", 429);
      }

      // 2. Health check (unauthenticated)
      if (url.pathname === "/api/v1/health" || url.pathname === "/health") {
        const socketConnected = await herdr.ping();
        return jsonResponse({
          status: socketConnected ? "ok" : "degraded",
          version: "0.1.0",
          herdr_socket_connected: socketConnected,
          socket_path: cfg.socketPath,
        });
      }

      // 3. Payload size inspection
      const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
      if (contentLength > 65_536) {
        return errorResponse("Payload exceeds maximum size of 64KB", "PAYLOAD_TOO_LARGE", 413);
      }

      const bodyText = req.method !== "GET" && req.method !== "HEAD" ? await req.text() : "";

      // 4. Authentication
      const auth = await authenticateRequest(req, bodyText, cfg);
      if (!auth.ok) {
        return errorResponse(auth.error ?? "Unauthorized", "UNAUTHORIZED", auth.statusCode ?? 401);
      }

      const identity = auth.identity!;

      try {
        // --- GET /api/v1/snapshot ---
        if (req.method === "GET" && url.pathname === "/api/v1/snapshot") {
          const snapshot = await herdr.getSnapshot();
          return jsonResponse(snapshot);
        }

        // --- GET /api/v1/agents/kinds ---
        if (req.method === "GET" && url.pathname === "/api/v1/agents/kinds") {
          return jsonResponse({
            supported_aliases: Object.keys(AGENT_KIND_MAP),
            primary_agents: ["opencode", "pi", "dsh", "claude-code", "antigravity"],
            canonical_kinds: ["pi", "claude", "codex", "gemini", "cursor", "opencode", "agy"],
          });
        }

        // --- POST /api/v1/agents/spawn ---
        if (req.method === "POST" && url.pathname === "/api/v1/agents/spawn") {
          let payload: any;
          try {
            payload = JSON.parse(bodyText);
          } catch {
            return errorResponse("Invalid JSON payload", "INVALID_JSON", 400);
          }

          const {
            workspace,
            direction = "right",
            agent_kind,
            agent_name,
            prompt,
            cwd,
            focus = false,
            approval_mode,
            yolo = false,
            agent_args,
          } = payload;

          // Check concurrency limit
          try {
            const panesRes = await herdr.listPanes();
            const panesList = panesRes?.result?.panes ?? panesRes?.panes ?? [];
            if (panesList.length >= cfg.maxPanes) {
              return errorResponse(
                `Max concurrent active panes limit (${cfg.maxPanes}) reached`,
                "MAX_PANES_EXCEEDED",
                429
              );
            }
          } catch {}

          if (!agent_name || !NAME_REGEX.test(agent_name)) {
            return errorResponse(
              "Field 'agent_name' is required and must match ^[a-zA-Z0-9_-]{1,64}$",
              "INVALID_AGENT_NAME",
              400
            );
          }

          if (!agent_kind) {
            return errorResponse("Field 'agent_kind' is required", "MISSING_AGENT_KIND", 400);
          }

          const normalizedKind = normalizeAgentKind(agent_kind);
          if (!normalizedKind) {
            return errorResponse(
              `Unsupported agent_kind '${agent_kind}'. Supported: ${Object.keys(AGENT_KIND_MAP).join(", ")}`,
              "INVALID_AGENT_KIND",
              400
            );
          }

          if (direction && direction !== "right" && direction !== "down") {
            return errorResponse("Field 'direction' must be 'right' or 'down'", "INVALID_DIRECTION", 400);
          }

          const syncParam = url.searchParams.get("sync");
          const sync = syncParam !== null ? syncParam !== "false" : true;

          const isYolo = yolo === true || approval_mode === "yolo" || approval_mode === "off";
          const resolvedMode = isYolo ? "yolo" : (approval_mode ?? "prompt");
          const customArgs = Array.isArray(agent_args)
            ? agent_args
            : isYolo
            ? (cfg.yoloArgs?.[normalizedKind] ?? cfg.yoloArgs?.[agent_kind.toLowerCase()] ?? ["--yolo"])
            : [];

          const spawnRes = await herdr.spawnAgent({
            workspace,
            direction,
            agentKind: normalizedKind,
            agentName: agent_name,
            prompt,
            cwd,
            focus,
            sync,
            approvalMode: resolvedMode,
            agentArgs: customArgs,
          });

          audit.log({
            timestamp: new Date().toISOString(),
            identity,
            ip: clientIp,
            action: "agents.spawn",
            params: {
              workspace,
              direction,
              agent_kind: normalizedKind,
              agent_name,
              cwd,
              focus,
              has_prompt: !!prompt,
              approval_mode: resolvedMode,
              agent_args: customArgs,
            },
            result: {
              ok: true,
              statusCode: spawnRes.status === "accepted" ? 202 : 201,
              paneId: spawnRes.pane_id,
            },
          });

          return jsonResponse(spawnRes, spawnRes.status === "accepted" ? 202 : 201);
        }

        // --- POST /api/v1/agents/prompt ---
        if (req.method === "POST" && url.pathname === "/api/v1/agents/prompt") {
          let payload: any;
          try {
            payload = JSON.parse(bodyText);
          } catch {
            return errorResponse("Invalid JSON payload", "INVALID_JSON", 400);
          }

          const { agent_name, prompt, wait = false } = payload;
          if (!agent_name || !prompt) {
            return errorResponse("Fields 'agent_name' and 'prompt' are required", "MISSING_PARAMETERS", 400);
          }

          await herdr.promptAgent(agent_name, prompt, wait);

          audit.log({
            timestamp: new Date().toISOString(),
            identity,
            ip: clientIp,
            action: "agents.prompt",
            params: { agent_name, wait, prompt_len: prompt.length },
            result: { ok: true, statusCode: 200 },
          });

          return jsonResponse({
            status: "delivered",
            agent_name,
            delivered_at: new Date().toISOString(),
          });
        }

        // --- GET /api/v1/panes/:paneId ---
        const paneGetMatch = url.pathname.match(/^\/api\/v1\/panes\/([^/]+)$/);
        if (req.method === "GET" && paneGetMatch) {
          const paneId = decodeURIComponent(paneGetMatch[1]);
          const lines = parseInt(url.searchParams.get("lines") ?? "100", 10);
          const format = (url.searchParams.get("format") ?? "text") as "text" | "ansi";

          const readRes = await herdr.readPane(paneId, lines, format);
          return jsonResponse({
            pane_id: paneId,
            lines,
            format,
            result: readRes,
          });
        }

        // --- POST /api/v1/panes/:paneId/keys ---
        const paneKeysMatch = url.pathname.match(/^\/api\/v1\/panes\/([^/]+)\/keys$/);
        if (req.method === "POST" && paneKeysMatch) {
          const paneId = decodeURIComponent(paneKeysMatch[1]);
          let payload: any;
          try {
            payload = JSON.parse(bodyText);
          } catch {
            return errorResponse("Invalid JSON payload", "INVALID_JSON", 400);
          }

          const { keys } = payload;
          if (!Array.isArray(keys) || keys.length === 0) {
            return errorResponse("Field 'keys' must be a non-empty array of key strings", "INVALID_KEYS", 400);
          }

          await herdr.sendKeys(paneId, keys);

          audit.log({
            timestamp: new Date().toISOString(),
            identity,
            ip: clientIp,
            action: "panes.keys",
            params: { paneId, keys },
            result: { ok: true, statusCode: 200, paneId },
          });

          return jsonResponse({ status: "keys_sent", pane_id: paneId, keys });
        }

        // --- POST /api/v1/panes/:paneId/close ---
        const paneCloseMatch = url.pathname.match(/^\/api\/v1\/panes\/([^/]+)\/close$/);
        if (req.method === "POST" && paneCloseMatch) {
          const paneId = decodeURIComponent(paneCloseMatch[1]);
          await herdr.closePane(paneId);

          audit.log({
            timestamp: new Date().toISOString(),
            identity,
            ip: clientIp,
            action: "panes.close",
            params: { paneId },
            result: { ok: true, statusCode: 200, paneId },
          });

          return jsonResponse({ status: "closed", pane_id: paneId });
        }

        return errorResponse(`Route not found: ${req.method} ${url.pathname}`, "NOT_FOUND", 404);
      } catch (handlerErr: any) {
        console.error("[server] Request processing error:", handlerErr);
        return errorResponse(
          handlerErr.message || "Internal server error",
          handlerErr.code || "INTERNAL_ERROR",
          500
        );
      }
    },
  });

  return server;
}

// Start standalone if executed directly
if (import.meta.main) {
  const s = createServer();
  console.log(`[herdr-agent-gateway] Listening on http://${s.hostname}:${s.port}`);
  console.log(`[herdr-agent-gateway] Socket path: ${config.socketPath}`);
  console.log(`[herdr-agent-gateway] Audit log: ${config.auditLogPath}`);

  const shutdown = () => {
    console.log("[herdr-agent-gateway] Shutting down cleanly...");
    s.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
