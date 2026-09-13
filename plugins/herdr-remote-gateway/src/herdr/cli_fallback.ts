import { spawn } from "node:child_process";

export class HerdrCliFallback {
  private binPath: string;

  constructor(binPath = "herdr") {
    this.binPath = binPath;
  }

  private run(args: string[], timeoutMs = 15_000): Promise<any> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.binPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error(`CLI command 'herdr ${args.join(" ")}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      proc.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });

      proc.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          try {
            resolve(stdout.trim() ? JSON.parse(stdout) : { ok: true });
          } catch {
            resolve({ raw: stdout.trim() });
          }
        } else {
          try {
            const errJson = JSON.parse(stderr);
            reject(errJson);
          } catch {
            reject(new Error(stderr.trim() || `CLI exited with status ${code}`));
          }
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  public async ping(): Promise<any> {
    return this.run(["status"]);
  }

  public async getSnapshot(): Promise<any> {
    return this.run(["api", "snapshot"]);
  }

  public async listWorkspaces(): Promise<any> {
    return this.run(["workspace", "list"]);
  }

  public async createWorkspace(label: string): Promise<any> {
    return this.run(["workspace", "create", "--label", label, "--no-focus"]);
  }

  public async listPanes(workspaceId?: string): Promise<any> {
    const args = ["pane", "list"];
    if (workspaceId) args.push("--workspace", workspaceId);
    return this.run(args);
  }

  public async createTab(options: {
    workspaceId?: string;
    label?: string;
    cwd?: string;
    focus?: boolean;
  }): Promise<any> {
    const args = ["tab", "create"];
    if (options.workspaceId) {
      args.push("--workspace", options.workspaceId);
    }
    if (options.label) {
      args.push("--label", options.label);
    }
    if (options.cwd) {
      args.push("--cwd", options.cwd);
    }
    if (options.focus === false) {
      args.push("--no-focus");
    } else if (options.focus === true) {
      args.push("--focus");
    }
    return this.run(args);
  }

  public async renameTab(tabId: string, label: string): Promise<any> {
    return this.run(["tab", "rename", tabId, label]);
  }

  public async splitPane(options: {
    workspaceId?: string;
    targetPaneId?: string;
    direction?: "right" | "down";
    cwd?: string;
    focus?: boolean;
  }): Promise<any> {
    const args = ["pane", "split"];
    if (options.targetPaneId) {
      args.push("--pane", options.targetPaneId);
    }
    if (options.direction) {
      args.push("--direction", options.direction);
    }
    if (options.cwd) {
      args.push("--cwd", options.cwd);
    }
    if (options.focus === false) {
      args.push("--no-focus");
    } else if (options.focus === true) {
      args.push("--focus");
    }
    return this.run(args);
  }

  public async startAgent(options: {
    name: string;
    kind: string;
    paneId: string;
    args?: string[];
    timeoutMs?: number;
  }): Promise<any> {
    const args = ["agent", "start", options.name, "--kind", options.kind, "--pane", options.paneId];
    if (options.timeoutMs) {
      args.push("--timeout", String(options.timeoutMs));
    }
    if (options.args && options.args.length > 0) {
      args.push("--", ...options.args);
    }
    return this.run(args, (options.timeoutMs ?? 30_000) + 5000);
  }

  public async promptAgent(options: {
    target: string;
    text: string;
    wait?: {
      until?: string[];
      timeout_ms?: number;
    } | null;
  }): Promise<any> {
    const args = ["agent", "prompt", options.target, options.text];
    if (options.wait) {
      args.push("--wait");
      if (options.wait.timeout_ms) {
        args.push("--timeout", String(options.wait.timeout_ms));
      }
      if (options.wait.until) {
        for (const u of options.wait.until) {
          args.push("--until", u);
        }
      }
    }
    return this.run(args, (options.wait?.timeout_ms ?? 30_000) + 5000);
  }

  public async waitAgent(options: {
    target: string;
    until?: string[];
    timeoutMs?: number;
  }): Promise<any> {
    const args = ["agent", "wait", options.target];
    if (options.timeoutMs) {
      args.push("--timeout", String(options.timeoutMs));
    }
    if (options.until) {
      for (const u of options.until) {
        args.push("--until", u);
      }
    }
    return this.run(args, (options.timeoutMs ?? 20_000) + 5000);
  }

  public async readPane(options: {
    paneId: string;
    lines?: number;
    source?: string;
    format?: string;
  }): Promise<any> {
    const args = ["pane", "read", options.paneId];
    if (options.lines) args.push("--lines", String(options.lines));
    if (options.source) args.push("--source", options.source);
    if (options.format) args.push("--format", options.format);
    return this.run(args);
  }

  public async sendKeys(paneId: string, keys: string[]): Promise<any> {
    return this.run(["pane", "send-keys", paneId, ...keys]);
  }

  public async closePane(paneId: string): Promise<any> {
    return this.run(["pane", "close", paneId]);
  }

  public async closeTab(tabId: string): Promise<any> {
    return this.run(["tab", "close", tabId]);
  }
}
