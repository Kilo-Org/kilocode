import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ManagedSessionClient, SessionId, SessionProbeResult } from "./types"

export interface SessionEnvelope {
  sessionId: SessionId
  kind: "message" | "resume"
  message?: string
  directory?: string
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
    await this.sendQueued(sessionId, message)
  }

  async sendQueued(sessionId: SessionId, message: string, directory?: string): Promise<void> {
    await this.writeEnvelope(sessionId, {
      sessionId,
      kind: "message",
      message,
      directory,
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

  async listPending(sessionId: SessionId): Promise<SessionEnvelope[]> {
    const files = await this.envelopeFiles(sessionId)
    const pending: SessionEnvelope[] = []
    for (const file of files) {
      const envelope = await this.readEnvelope(file)
      if (envelope) pending.push(envelope)
    }
    return pending.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  async consumePending(sessionId: SessionId, limit = 10): Promise<SessionEnvelope[]> {
    const files = await this.envelopeFiles(sessionId)
    const taken = files.slice(0, Math.max(0, limit))
    const pending: SessionEnvelope[] = []
    for (const file of taken) {
      const envelope = await this.readEnvelope(file)
      if (envelope) pending.push(envelope)
      await unlink(file)
    }
    return pending
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

  private async envelopeFiles(sessionId: string): Promise<string[]> {
    try {
      const dir = this.sessionDir(sessionId)
      const entries = await readdir(dir)
      return entries
        .filter((name) => name.endsWith(".json"))
        .map((name) => path.join(dir, name))
        .sort()
    } catch (error) {
      if (isNotFound(error)) return []
      throw error
    }
  }

  private async readEnvelope(file: string): Promise<SessionEnvelope | undefined> {
    try {
      const raw = JSON.parse(await readFile(file, "utf8")) as SessionEnvelope
      if (!raw || typeof raw.sessionId !== "string" || typeof raw.kind !== "string") return undefined
      return raw
    } catch {
      return undefined
    }
  }

  private async writeEnvelope(sessionId: string, envelope: SessionEnvelope): Promise<void> {
    const dir = this.sessionDir(sessionId)
    await mkdir(dir, { recursive: true })
    const filename = `${Date.now()}-${envelope.kind}-${crypto.randomUUID()}.json`
    await writeFile(path.join(dir, filename), `${JSON.stringify(envelope, null, 2)}\n`, "utf8")
  }
}
