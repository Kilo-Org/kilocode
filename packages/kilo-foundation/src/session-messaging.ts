import { mkdir, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import type { ManagedSessionClient, SessionId, SessionProbeResult } from "./types"

export interface SessionEnvelope {
  sessionId: SessionId
  kind: "message" | "resume"
  message?: string
  directory?: string
  createdAt: string
  extra?: Record<string, unknown>
}

export type SessionMessengerClock = {
  now(): number
}

type ListedEnvelope = {
  file: string
  envelope: SessionEnvelope | undefined
}

function sanitizeSessionId(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "")
  return safe.length > 0 ? safe : "session"
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "ENOENT"
}

function sameEnvelope(left: SessionEnvelope, right: SessionEnvelope): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.kind === right.kind &&
    left.message === right.message &&
    left.directory === right.directory &&
    left.createdAt === right.createdAt
  )
}

function compareListed(left: ListedEnvelope, right: ListedEnvelope): number {
  const byCreated = (left.envelope?.createdAt ?? "").localeCompare(right.envelope?.createdAt ?? "")
  return byCreated !== 0 ? byCreated : left.file.localeCompare(right.file)
}

/**
 * Persist envelopes on disk and deliver at a safe boundary. No LLM polling.
 */
export class FileBackedSessionMessenger implements ManagedSessionClient {
  private seq = 0

  constructor(
    private readonly inboxRoot: string,
    private readonly clock: SessionMessengerClock = { now: () => Date.now() },
  ) {}

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

  async sendQueued(
    sessionId: SessionId,
    message: string,
    directory?: string,
    extra?: Record<string, unknown>,
    createdAt?: string,
  ): Promise<void> {
    const now = this.clock.now()
    await this.writeEnvelope(
      sessionId,
      {
        sessionId,
        kind: "message",
        message,
        directory,
        createdAt: createdAt ?? new Date(now).toISOString(),
        ...(extra ? { extra } : {}),
      },
      now,
    )
  }

  async resume(sessionId: SessionId): Promise<void> {
    const now = this.clock.now()
    await this.writeEnvelope(
      sessionId,
      {
        sessionId,
        kind: "resume",
        createdAt: new Date(now).toISOString(),
      },
      now,
    )
  }

  async listPending(sessionId: SessionId): Promise<SessionEnvelope[]> {
    const listed = await this.listedEnvelopes(sessionId)
    return listed.flatMap((item) => (item.envelope ? [item.envelope] : []))
  }

  async consumePending(sessionId: SessionId, limit = 10): Promise<SessionEnvelope[]> {
    const listed = await this.listedEnvelopes(sessionId)
    const readable = listed.filter((item): item is ListedEnvelope & { envelope: SessionEnvelope } => !!item.envelope)
    const taken = readable.slice(0, Math.max(0, limit))
    const pending: SessionEnvelope[] = []
    for (const item of taken) {
      pending.push(item.envelope)
      await this.unlinkEnvelope(item.file)
    }
    return pending
  }

  async consumeEnvelope(sessionId: SessionId, envelope: SessionEnvelope): Promise<void> {
    const listed = await this.listedEnvelopes(sessionId)
    const match = listed.find((item) => item.envelope && sameEnvelope(item.envelope, envelope))
    if (!match) return
    await this.unlinkEnvelope(match.file)
  }

  async dropSession(sessionId: SessionId): Promise<void> {
    try {
      await rm(this.sessionDir(sessionId), { recursive: true, force: true })
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
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

  private async listedEnvelopes(sessionId: string): Promise<ListedEnvelope[]> {
    const files = await this.envelopeFiles(sessionId)
    const listed: ListedEnvelope[] = []
    for (const file of files) {
      listed.push({ file, envelope: await this.readEnvelope(file) })
    }
    return listed.sort(compareListed)
  }

  private async envelopeFiles(sessionId: string): Promise<string[]> {
    try {
      const dir = this.sessionDir(sessionId)
      const entries = await readdir(dir)
      return entries.filter((name) => name.endsWith(".json")).map((name) => path.join(dir, name))
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

  private async unlinkEnvelope(file: string): Promise<void> {
    try {
      await unlink(file)
    } catch (error) {
      if (isNotFound(error)) return
      console.warn("[kilo-foundation] failed to unlink managed inbox envelope", file, error)
    }
  }

  private async writeEnvelope(sessionId: string, envelope: SessionEnvelope, now = this.clock.now()): Promise<void> {
    const dir = this.sessionDir(sessionId)
    await mkdir(dir, { recursive: true })
    const filename = `${now}-${String(++this.seq).padStart(6, "0")}-${envelope.kind}-${crypto.randomUUID()}.json`
    await writeFile(path.join(dir, filename), `${JSON.stringify(envelope, null, 2)}\n`, "utf8")
  }
}
