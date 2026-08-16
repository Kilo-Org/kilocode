import { mkdir, readdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ManagedSessionClient, SessionId, SessionProbeResult } from "./types"

export interface SessionEnvelope {
  sessionId: SessionId
  kind: "message" | "resume"
  message?: string
  createdAt: string
}

function sanitizeSessionId(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "")
  return safe.length > 0 ? safe : "session"
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "ENOENT"
}

/**
 * Persist envelopes on disk and deliver at a safe boundary. No LLM polling.
 */
export class FileBackedSessionMessenger implements ManagedSessionClient {
  constructor(private readonly inboxRoot: string) {}

  private sessionDir(sessionId: string): string {
    return path.join(this.inboxRoot, sanitizeSessionId(sessionId))
  }

  async listSessions(): Promise<SessionId[]> {
    try {
      const entries = await readdir(this.inboxRoot, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    } catch (error) {
      if (isNotFound(error)) {
        return []
      }
      throw error
    }
  }

  async createSession(title: string): Promise<SessionId> {
    const sessionId = sanitizeSessionId(title)
    await mkdir(this.sessionDir(sessionId), { recursive: true })
    return sessionId
  }

  async sendMessage(sessionId: SessionId, message: string): Promise<void> {
    await this.writeEnvelope(sessionId, {
      sessionId,
      kind: "message",
      message,
      createdAt: new Date().toISOString(),
    })
  }

  async resume(sessionId: SessionId): Promise<void> {
    await this.writeEnvelope(sessionId, {
      sessionId,
      kind: "resume",
      createdAt: new Date().toISOString(),
    })
  }

  async probe(): Promise<SessionProbeResult> {
    const sessions = await this.listSessions()
    return {
      reachable: true,
      status: "reachable",
      sessionCount: sessions.length,
      detail: "file-backed session inbox",
    }
  }

  private async writeEnvelope(sessionId: string, envelope: SessionEnvelope): Promise<void> {
    const dir = this.sessionDir(sessionId)
    await mkdir(dir, { recursive: true })
    const filename = `${Date.now()}-${envelope.kind}-${crypto.randomUUID()}.json`
    await writeFile(path.join(dir, filename), `${JSON.stringify(envelope, null, 2)}\n`, "utf8")
  }
}
