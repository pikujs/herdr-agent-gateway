import { HerdrSocketClient } from "./socket";
import { HerdrCliFallback } from "./cli_fallback";
import { resolveAgentYoloArgs } from "../config";

export interface SpawnOptions {
  workspace?: string;
  direction?: "right" | "down";
  agentKind: string;
  agentName: string;
  prompt?: string;
  cwd?: string;
  focus?: boolean;
  sync?: boolean;
  approvalMode?: string;
  agentArgs?: string[];
}

export interface SpawnResult {
  status: "success" | "accepted";
  pane_id: string;
  workspace_id?: string;
  tab_id?: string;
  agent_name: string;
  agent_kind: string;
  session_state: string;
  created_at: string;
}

export class HerdrClient {
  private socket: HerdrSocketClient;
  private cli: HerdrCliFallback;
  private defaultWorkspace: string;

  constructor(socketPath: string, binPath: string, defaultWorkspace = "spawned-agents") {
    this.socket = new HerdrSocketClient(socketPath);
    this.cli = new HerdrCliFallback(binPath);
    this.defaultWorkspace = defaultWorkspace;
  }

  private async executeWithFallback<T>(
    socketFn: (socket: HerdrSocketClient) => Promise<T>,
    cliFn: (cli: HerdrCliFallback) => Promise<T>
  ): Promise<T> {
    try {
      return await socketFn(this.socket);
    } catch (socketErr) {
      console.warn("[herdr-client] Socket IPC failed, attempting CLI fallback:", socketErr);
      return await cliFn(this.cli);
    }
  }

  public async ping(): Promise<boolean> {
    try {
      await this.executeWithFallback(
        (s) => s.ping(),
        (c) => c.ping()
      );
      return true;
    } catch {
      return false;
    }
  }

  public async getSnapshot(): Promise<any> {
    return this.executeWithFallback(
      (s) => s.getSnapshot(),
      (c) => c.getSnapshot()
    );
  }

  public async listPanes(workspaceId?: string): Promise<any> {
    return this.executeWithFallback(
      (s) => s.listPanes(workspaceId),
      (c) => c.listPanes(workspaceId)
    );
  }

  public async ensureWorkspace(targetNameOrId?: string): Promise<{ workspaceId: string; freshTabId?: string; freshPaneId?: string }> {
    const target = targetNameOrId?.trim() || this.defaultWorkspace;

    // Discover existing workspaces
    const res = await this.executeWithFallback(
      (s) => s.listWorkspaces(),
      (c) => c.listWorkspaces()
    );

    const list: any[] = res?.result?.workspaces ?? res?.workspaces ?? [];
    const existing = list.find((w: any) => w.workspace_id === target || w.label === target);
    if (existing) {
      return { workspaceId: existing.workspace_id };
    }

    // Workspace does not exist: create it
    const created = await this.executeWithFallback(
      (s) => s.createWorkspace(target),
      (c) => c.createWorkspace(target)
    );

    const wsId =
      created?.result?.workspace?.workspace_id ??
      created?.workspace?.workspace_id ??
      created?.result?.workspace_id ??
      target;

    const freshTabId =
      created?.result?.tab?.tab_id ??
      created?.tab?.tab_id ??
      created?.result?.workspace?.active_tab_id;

    const freshPaneId =
      created?.result?.root_pane?.pane_id ??
      created?.root_pane?.pane_id;

    return { workspaceId: wsId, freshTabId, freshPaneId };
  }

  public async spawnAgent(options: SpawnOptions): Promise<SpawnResult> {
    const { workspaceId, freshTabId, freshPaneId } = await this.ensureWorkspace(options.workspace);

    let paneId = freshPaneId;
    let tabId = freshTabId;

    if (freshTabId && paneId) {
      // Use the newly created workspace's primary tab and rename it
      try {
        await this.executeWithFallback(
          (s) => s.renameTab(freshTabId, options.agentName),
          (c) => c.renameTab(freshTabId, options.agentName)
        );
      } catch (renameErr) {
        console.warn(`[herdr-client] Could not rename initial tab ${freshTabId}:`, renameErr);
      }
    } else {
      // Workspace already existed: create a new tab in this workspace
      const tabRes = await this.executeWithFallback(
        (s) =>
          s.createTab({
            workspaceId,
            label: options.agentName,
            cwd: options.cwd,
            focus: options.focus ?? false,
          }),
        (c) =>
          c.createTab({
            workspaceId,
            label: options.agentName,
            cwd: options.cwd,
            focus: options.focus ?? false,
          })
      );

      const pane = tabRes?.result?.root_pane ?? tabRes?.root_pane ?? tabRes?.result?.pane ?? tabRes?.pane;
      const tab = tabRes?.result?.tab ?? tabRes?.tab;
      paneId = pane?.pane_id ?? tabRes?.pane_id;
      tabId = tab?.tab_id ?? tabRes?.tab_id;
    }

    if (!paneId) {
      throw new Error(`Failed to allocate tab in workspace '${workspaceId}'`);
    }

    const createdAt = new Date().toISOString();

    const isYolo = options.approvalMode === "yolo" || options.approvalMode === "off";
    let finalArgs: string[] = options.agentArgs ? [...options.agentArgs] : [];
    if (isYolo && finalArgs.length === 0) {
      finalArgs = resolveAgentYoloArgs(options.agentKind);
    }

    // If async mode requested without prompt, return immediately
    if (options.sync === false && !options.prompt) {
      // Trigger agent start in background
      this.executeWithFallback(
        (s) => s.startAgent({ name: options.agentName, kind: options.agentKind, paneId, args: finalArgs }),
        (c) => c.startAgent({ name: options.agentName, kind: options.agentKind, paneId, args: finalArgs })
      ).catch((err) => console.error(`[herdr-client] Async agent start error on pane ${paneId}:`, err));

      return {
        status: "accepted",
        pane_id: paneId,
        workspace_id: workspaceId,
        tab_id: tabId,
        agent_name: options.agentName,
        agent_kind: options.agentKind,
        session_state: "starting",
        created_at: createdAt,
      };
    }

    // 2. Wait for shell prompt to be interactive
    for (let i = 0; i < 25; i++) {
      try {
        const out = await this.readPane(paneId, 10, "text");
        const raw = out?.result?.raw ?? out?.raw ?? "";
        if (raw.includes("❯") || raw.includes("$") || raw.includes("#") || raw.includes(">") || raw.includes("%")) {
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }

    // 3. Start Agent (wait for readiness)
    await this.executeWithFallback(
      (s) => s.startAgent({ name: options.agentName, kind: options.agentKind, paneId, args: finalArgs }),
      (c) => c.startAgent({ name: options.agentName, kind: options.agentKind, paneId, args: finalArgs })
    );

    // 4. Submit Initial Prompt if provided
    let sessionState = "idle";
    if (options.prompt) {
      try {
        await this.executeWithFallback(
          (s) => s.waitAgent({ target: options.agentName, until: ["idle"], timeoutMs: 20_000 }),
          (c) => c.waitAgent({ target: options.agentName, until: ["idle"], timeoutMs: 20_000 })
        );
      } catch (wErr) {
        console.warn(`[herdr-client] waitAgent notice:`, wErr);
      }

      await this.executeWithFallback(
        (s) =>
          s.promptAgent({
            target: options.agentName,
            text: options.prompt!,
            wait: { until: ["idle", "working", "blocked", "done"], timeout_ms: 10_000 },
          }),
        (c) =>
          c.promptAgent({
            target: options.agentName,
            text: options.prompt!,
            wait: { until: ["idle", "working", "blocked", "done"], timeout_ms: 10_000 },
          })
      );
      sessionState = "working";
    }

    return {
      status: "success",
      pane_id: paneId,
      workspace_id: workspaceId,
      tab_id: tabId,
      agent_name: options.agentName,
      agent_kind: options.agentKind,
      session_state: sessionState,
      created_at: createdAt,
    };
  }

  public async promptAgent(target: string, prompt: string, wait = false): Promise<any> {
    return this.executeWithFallback(
      (s) =>
        s.promptAgent({
          target,
          text: prompt,
          wait: wait ? { until: ["idle", "working", "blocked", "done"], timeout_ms: 15_000 } : null,
        }),
      (c) =>
        c.promptAgent({
          target,
          text: prompt,
          wait: wait ? { until: ["idle", "working", "blocked", "done"], timeout_ms: 15_000 } : null,
        })
    );
  }

  public async waitAgent(target: string, until = ["idle"], timeoutMs = 20_000): Promise<any> {
    return this.executeWithFallback(
      (s) => s.waitAgent({ target, until, timeoutMs }),
      (c) => c.waitAgent({ target, until, timeoutMs })
    );
  }

  public async readPane(paneId: string, lines = 100, format: "text" | "ansi" = "text"): Promise<any> {
    return this.executeWithFallback(
      (s) => s.readPane({ paneId, lines, format }),
      (c) => c.readPane({ paneId, lines, format })
    );
  }

  public async sendKeys(paneId: string, keys: string[]): Promise<any> {
    return this.executeWithFallback(
      (s) => s.sendKeys(paneId, keys),
      (c) => c.sendKeys(paneId, keys)
    );
  }

  public async closePane(paneId: string): Promise<any> {
    return this.executeWithFallback(
      (s) => s.closePane(paneId),
      (c) => c.closePane(paneId)
    );
  }

  public async closeTab(tabId: string): Promise<any> {
    return this.executeWithFallback(
      (s) => s.closeTab(tabId),
      (c) => c.closeTab(tabId)
    );
  }
}
