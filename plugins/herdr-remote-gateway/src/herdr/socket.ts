import net from "node:net";

export class HerdrSocketClient {
  private socketPath: string;
  private reqIdCounter = 0;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  public async call<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<T> {
    const id = `g${++this.reqIdCounter}_${Date.now()}`;
    const payload = JSON.stringify({ id, method, params }) + "\n";

    return new Promise<T>((resolve, reject) => {
      const sock = net.createConnection(this.socketPath);
      let buffer = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          sock.destroy();
          reject(new Error(`Herdr socket request timed out after ${timeoutMs}ms (method: ${method})`));
        }
      }, timeoutMs);

      sock.on("connect", () => {
        try {
          sock.write(payload, "utf8");
        } catch (err) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            sock.destroy();
            reject(err);
          }
        }
      });

      sock.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const newlineIdx = buffer.indexOf("\n");
        if (newlineIdx !== -1) {
          const line = buffer.slice(0, newlineIdx).trim();
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            sock.destroy();
            try {
              const msg = JSON.parse(line);
              if (msg.error) {
                reject(msg.error);
              } else {
                resolve(msg.result);
              }
            } catch (parseErr) {
              reject(parseErr);
            }
          }
        }
      });

      sock.on("error", (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });

      sock.on("close", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`Herdr socket connection closed before response received (method: ${method})`));
        }
      });
    });
  }

  // --- High-level Socket API wrappers ---

  public async ping(): Promise<{ ok: boolean }> {
    return this.call("ping", {}, 3000);
  }

  public async getSnapshot(): Promise<any> {
    return this.call("session.snapshot", {}, 5000);
  }

  public async listWorkspaces(): Promise<any> {
    return this.call("workspace.list", {}, 5000);
  }

  public async createWorkspace(label: string): Promise<any> {
    return this.call("workspace.create", { label, focus: false }, 5000);
  }

  public async listPanes(workspaceId?: string): Promise<any> {
    const params: Record<string, unknown> = {};
    if (workspaceId) params.workspace_id = workspaceId;
    return this.call("pane.list", params, 5000);
  }

  public async createTab(options: {
    workspaceId?: string;
    label?: string;
    cwd?: string;
    focus?: boolean;
  }): Promise<any> {
    return this.call(
      "tab.create",
      {
        workspace_id: options.workspaceId ?? null,
        label: options.label ?? null,
        cwd: options.cwd ?? null,
        focus: options.focus ?? false,
      },
      5000
    );
  }

  public async renameTab(tabId: string, label: string): Promise<any> {
    return this.call("tab.rename", { tab_id: tabId, label }, 5000);
  }

  public async splitPane(options: {
    workspaceId?: string;
    targetPaneId?: string;
    direction?: "right" | "down";
    cwd?: string;
    focus?: boolean;
  }): Promise<any> {
    return this.call(
      "pane.split",
      {
        workspace_id: options.workspaceId ?? null,
        target_pane_id: options.targetPaneId ?? null,
        direction: options.direction ?? "right",
        cwd: options.cwd ?? null,
        focus: options.focus ?? false,
      },
      5000
    );
  }

  public async startAgent(options: {
    name: string;
    kind: string;
    paneId: string;
    args?: string[];
    timeoutMs?: number;
  }): Promise<any> {
    return this.call(
      "agent.start",
      {
        name: options.name,
        kind: options.kind,
        pane_id: options.paneId,
        args: options.args ?? [],
        timeout_ms: options.timeoutMs ?? 30_000,
      },
      (options.timeoutMs ?? 30_000) + 5000
    );
  }

  public async promptAgent(options: {
    target: string;
    text: string;
    wait?: {
      until?: string[];
      timeout_ms?: number;
    } | null;
  }): Promise<any> {
    const timeout = (options.wait?.timeout_ms ?? 30_000) + 5000;
    return this.call(
      "agent.prompt",
      {
        target: options.target,
        text: options.text,
        wait: options.wait ?? null,
      },
      timeout
    );
  }

  public async waitAgent(options: {
    target: string;
    until?: string[];
    timeoutMs?: number;
  }): Promise<any> {
    const timeoutMs = options.timeoutMs ?? 20_000;
    return this.call(
      "agent.wait",
      {
        target: options.target,
        until: options.until ?? ["idle"],
        timeout_ms: timeoutMs,
      },
      timeoutMs + 5000
    );
  }

  public async readPane(options: {
    paneId: string;
    lines?: number;
    source?: "recent" | "recent_unwrapped" | "visible" | "detection";
    format?: "text" | "ansi";
    stripAnsi?: boolean;
  }): Promise<any> {
    return this.call(
      "pane.read",
      {
        pane_id: options.paneId,
        lines: options.lines ?? 100,
        source: options.source ?? "recent_unwrapped",
        format: options.format ?? "text",
        strip_ansi: options.stripAnsi ?? true,
      },
      5000
    );
  }

  public async sendKeys(paneId: string, keys: string[]): Promise<any> {
    return this.call("pane.send_keys", { pane_id: paneId, keys }, 5000);
  }

  public async closePane(paneId: string): Promise<any> {
    return this.call("pane.close", { pane_id: paneId }, 5000);
  }

  public async closeTab(tabId: string): Promise<any> {
    return this.call("tab.close", { tab_id: tabId }, 5000);
  }
}
