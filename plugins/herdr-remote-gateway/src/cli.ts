import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolveConfig } from "./config";

const config = resolveConfig();
const action = process.argv[2] ?? "status";

function notify(title: string, body?: string): void {
  const binary = process.env.HERDR_BIN_PATH ?? "herdr";
  const args = ["notification", "show", title];
  if (body) args.push("--body", body);
  spawnSync(binary, args, { stdio: "ignore" });
}

async function handleStatus(): Promise<void> {
  const url = `http://${config.host}:${config.port}/api/v1/health`;
  let httpOk = false;
  let serverInfo: any = null;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      httpOk = true;
      serverInfo = await res.json();
    }
  } catch {}

  let systemdStatus = "unknown";
  if (process.platform === "linux") {
    const res = spawnSync("systemctl", ["--user", "is-active", "herdr-agent-gateway"], {
      encoding: "utf8",
    });
    systemdStatus = res.stdout.trim() || res.stderr.trim() || "inactive";
  }

  console.log("=== Herdr Agent Gateway Status ===");
  console.log(`Endpoint:       http://${config.host}:${config.port}`);
  console.log(`HTTP Listener:  ${httpOk ? "ONLINE (healthy)" : "OFFLINE"}`);
  if (serverInfo) {
    console.log(`Herdr Socket:   ${serverInfo.herdr_socket_connected ? "CONNECTED" : "DISCONNECTED"}`);
    console.log(`Version:        ${serverInfo.version}`);
  }
  if (process.platform === "linux") {
    console.log(`Systemd Unit:   ${systemdStatus}`);
  }
  console.log(`Config Dir:     ${config.configDir}`);
  console.log(`State Dir:      ${config.stateDir}`);
  console.log(`Audit Log:      ${config.auditLogPath}`);
  console.log(`Token File:     ${config.tokenFile} (${fs.existsSync(config.tokenFile) ? "present" : "missing"})`);

  notify(
    httpOk ? "Gateway Online" : "Gateway Offline",
    `http://${config.host}:${config.port} (${systemdStatus})`
  );
}

function handleSetup(): void {
  console.log("=== Setting up Herdr Agent Gateway ===");

  fs.mkdirSync(config.configDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });

  // Generate gateway.token if missing
  if (!fs.existsSync(config.tokenFile) && !process.env.HERDR_GATEWAY_TOKEN) {
    const generatedToken = "sec_" + crypto.randomBytes(24).toString("hex");
    fs.writeFileSync(config.tokenFile, `${generatedToken}\n`, { mode: 0o600 });
    console.log(`Generated new secret token: ${config.tokenFile}`);
  }

  // Generate gateway.env template if missing
  const envFile = path.join(config.configDir, "gateway.env");
  if (!fs.existsSync(envFile)) {
    const defaultEnv = `# Herdr Agent Gateway Environment
HERDR_GATEWAY_HOST=${config.host}
HERDR_GATEWAY_PORT=${config.port}
HERDR_GATEWAY_DEFAULT_WORKSPACE=${config.defaultWorkspace}
HERDR_GATEWAY_MAX_PANES=${config.maxPanes}
`;
    fs.writeFileSync(envFile, defaultEnv, { mode: 0o600 });
    console.log(`Created default environment file: ${envFile}`);
  }

  // Linux systemd user service setup
  if (process.platform === "linux") {
    const systemdUserDir = path.join(os.homedir(), ".config", "systemd", "user");
    fs.mkdirSync(systemdUserDir, { recursive: true });

    const bunPath = spawnSync("which", ["bun"], { encoding: "utf8" }).stdout.trim() || "/usr/bin/bun";
    const serverScript = path.resolve(import.meta.dir, "server.ts");

    const unitContent = `[Unit]
Description=Herdr Agent Gateway HTTP Daemon
After=network.target

[Service]
Type=simple
EnvironmentFile=-${envFile}
ExecStart=${bunPath} run ${serverScript}
Restart=on-failure
RestartSec=3s

[Install]
WantedBy=default.target
`;

    const unitPath = path.join(systemdUserDir, "herdr-agent-gateway.service");
    fs.writeFileSync(unitPath, unitContent, { mode: 0o644 });
    console.log(`Wrote systemd user service: ${unitPath}`);

    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
    spawnSync("systemctl", ["--user", "enable", "--now", "herdr-agent-gateway"], { stdio: "inherit" });
    console.log("Service enabled and started under systemd --user!");
    notify("Gateway Service Setup", "Installed and started herdr-agent-gateway.service");
  } else {
    console.log(`Setup complete for ${process.platform}. Start manually via: bun run src/server.ts`);
  }
}

function handleRestart(): void {
  if (process.platform === "linux") {
    console.log("Restarting systemd user service herdr-agent-gateway...");
    const res = spawnSync("systemctl", ["--user", "restart", "herdr-agent-gateway"], { stdio: "inherit" });
    if (res.status === 0) {
      notify("Gateway Restarted", "systemctl --user restart herdr-agent-gateway succeeded");
    }
  } else {
    console.log("On non-Linux platforms, restart your background bun process manually.");
  }
}

switch (action) {
  case "setup":
    handleSetup();
    break;
  case "restart":
    handleRestart();
    break;
  case "status":
  default:
    await handleStatus();
    break;
}
