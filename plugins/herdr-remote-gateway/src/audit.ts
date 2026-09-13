import fs from "node:fs";
import path from "node:path";

export interface AuditRecord {
  timestamp: string;
  identity: string;
  ip: string;
  action: string;
  params: Record<string, unknown>;
  result: {
    ok: boolean;
    statusCode: number;
    paneId?: string;
    error?: string;
  };
}

export class AuditLogger {
  private logPath: string;

  constructor(logPath: string) {
    this.logPath = logPath;
    const dir = path.dirname(logPath);
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      } catch (err) {
        console.error(`[audit] Failed to create audit log directory ${dir}:`, err);
      }
    }
  }

  log(record: AuditRecord): void {
    const line = JSON.stringify(record) + "\n";
    try {
      fs.appendFileSync(this.logPath, line, { mode: 0o600 });
    } catch (err) {
      console.error(`[audit] Failed to write to audit log ${this.logPath}:`, err);
    }
  }
}
