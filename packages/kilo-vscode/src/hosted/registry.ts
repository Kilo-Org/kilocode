/**
 * Local attachment registry.
 *
 * Attachments are process-local on the backend, so the client caches at most
 * one per hosted identity and treats a backend restart as invalidation. A
 * burst of requests for the same identity shares one attach call, and a
 * detach or invalidation always wins over an in-flight attach.
 */
export interface Attachment {
  key: string
  providerID: string
  sessionID: string
  attachmentID: string
  /** Provider-declared descriptor expiry. A hint for diagnostics only. */
  expiresAt: number
}

export interface AttachmentPort {
  attach(input: { providerID: string; sessionID: string }): Promise<{ attachmentID: string; expiresAt: number }>
  detach(attachmentID: string): Promise<void>
}

interface Pending {
  promise: Promise<Attachment>
  resolve: (attachment: Attachment) => void
  reject: (error: unknown) => void
}

export class HostedRegistry {
  private readonly entries = new Map<string, Attachment>()
  private readonly pending = new Map<string, Pending>()
  private readonly versions = new Map<string, number>()

  private version(key: string): number {
    return this.versions.get(key) ?? 0
  }

  private stale(key: string): void {
    this.versions.set(key, this.version(key) + 1)
    this.entries.delete(key)
    const pending = this.pending.get(key)
    this.pending.delete(key)
    pending?.reject(new Error("Hosted attachment was invalidated"))
  }

  get(key: string): Attachment | undefined {
    return this.entries.get(key)
  }

  keys(): string[] {
    return [...this.entries.keys()]
  }

  ensure(key: string, identity: { providerID: string; sessionID: string }, port: AttachmentPort): Promise<Attachment> {
    const found = this.entries.get(key)
    if (found) return Promise.resolve(found)
    const pending = this.pending.get(key)
    if (pending) return pending.promise

    // The rejection is delivered to callers; also mark it handled so an
    // invalidation during shutdown cannot surface as an unhandled rejection.
    const deferred = Promise.withResolvers<Attachment>()
    deferred.promise.catch(() => undefined)
    const start = this.version(key)
    this.pending.set(key, { promise: deferred.promise, resolve: deferred.resolve, reject: deferred.reject })

    port.attach(identity).then(
      (value) => {
        const entry: Attachment = {
          key,
          providerID: identity.providerID,
          sessionID: identity.sessionID,
          attachmentID: value.attachmentID,
          expiresAt: value.expiresAt,
        }
        if (this.version(key) !== start) {
          // Invalidation or a detach won the race. The backend attachment is
          // already minted, so release it instead of leaking it until expiry.
          port.detach(value.attachmentID).catch(() => undefined)
          deferred.reject(new Error("Hosted attachment was invalidated"))
          return
        }
        this.entries.set(key, entry)
        if (this.pending.get(key)?.promise === deferred.promise) this.pending.delete(key)
        deferred.resolve(entry)
      },
      (error: unknown) => {
        if (this.pending.get(key)?.promise === deferred.promise) this.pending.delete(key)
        deferred.reject(error)
      },
    )
    return deferred.promise
  }

  invalidate(key: string): void {
    this.stale(key)
  }

  async detach(key: string, port: AttachmentPort): Promise<void> {
    const found = this.entries.get(key)
    this.stale(key)
    if (!found) return
    await port.detach(found.attachmentID)
  }

  reset(): void {
    for (const key of new Set([...this.entries.keys(), ...this.pending.keys()])) this.stale(key)
  }
}
