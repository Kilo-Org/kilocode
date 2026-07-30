/**
 * ProjectRegistry — global catalog of additional Agent Manager projects.
 *
 * The registry persists only *additional* projects: repositories the user
 * explicitly added through the Agent Manager project picker. The pinned
 * default project is always derived from the current VS Code workspace at
 * runtime and is never stored here.
 *
 * Storage is injected so the registry stays free of VS Code imports and can
 * be unit-tested with an in-memory store. The file is versioned; corrupt or
 * foreign content fails closed to an empty catalog and is repaired by the
 * next mutation.
 *
 * Concurrency model: every mutation is funneled through a single in-instance
 * queue, and each mutation re-reads storage immediately before applying its
 * change. That makes a mutation atomic with respect to other mutations on the
 * same instance and lets it merge with the latest persisted state even when
 * the in-memory cache is stale (another window wrote in the meantime). The
 * cache is reassigned only after the write succeeds, so a failed write never
 * leaves memory ahead of storage. There is no cross-process lock by design.
 */

export interface StoredProject {
  /** Deterministic id from projectIdFor(root). */
  id: string
  /** Canonical Git top-level path. */
  root: string
  /** Optional user-facing display name. */
  label?: string
  order: number
  /** Whether project-controlled scripts may execute for this project. */
  trusted: boolean
  addedAt: string
}

interface RegistryFile {
  version: 1
  projects: StoredProject[]
}

export interface RegistryStorage {
  read(): unknown
  write(value: unknown): Promise<void> | void
}

const VERSION = 1

function valid(entry: unknown): entry is StoredProject {
  if (!entry || typeof entry !== "object") return false
  const e = entry as Record<string, unknown>
  return (
    typeof e.id === "string" &&
    typeof e.root === "string" &&
    typeof e.order === "number" &&
    typeof e.trusted === "boolean" &&
    typeof e.addedAt === "string"
  )
}

function parse(raw: unknown, log: (msg: string) => void): StoredProject[] {
  if (!raw || typeof raw !== "object") return []
  const file = raw as Partial<RegistryFile>
  if (file.version !== VERSION || !Array.isArray(file.projects)) {
    if (file.version !== undefined) log("project registry has an unsupported shape, starting empty")
    return []
  }
  const seen = new Set<string>()
  const out: StoredProject[] = []
  for (const entry of file.projects) {
    if (!valid(entry)) continue
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    out.push(entry)
  }
  return out.sort((a, b) => a.order - b.order)
}

export class ProjectRegistry {
  private projects: StoredProject[] | undefined
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly storage: RegistryStorage,
    private readonly log: (msg: string) => void = () => {},
  ) {}

  private load(): StoredProject[] {
    this.projects ??= parse(this.storage.read(), this.log)
    return this.projects
  }

  /** Fresh re-read + validate/dedupe/sort, used by every mutation. */
  private fresh(): StoredProject[] {
    return parse(this.storage.read(), this.log)
  }

  /** Persist the next catalog and update the cache only after the write succeeds. */
  private async write(next: StoredProject[]): Promise<void> {
    const file: RegistryFile = { version: VERSION, projects: next }
    await this.storage.write(file)
    this.projects = next
  }

  /** Serialize mutations within this instance; a failed mutation does not poison the queue. */
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.catch(() => {}).then(fn)
    this.queue = result.then(
      () => {},
      () => {},
    )
    return result
  }

  list(): StoredProject[] {
    return [...this.load()]
  }

  get(id: string): StoredProject | undefined {
    return this.load().find((p) => p.id === id)
  }

  /** Register an additional project. Throws when the id is already registered. */
  add(input: { id: string; root: string; label?: string }): Promise<StoredProject> {
    return this.run(() => this.doAdd(input))
  }

  private async doAdd(input: { id: string; root: string; label?: string }): Promise<StoredProject> {
    const current = this.fresh()
    if (current.find((p) => p.id === input.id)) throw new Error("That repository is already registered as a project.")
    const order = current.reduce((max, p) => Math.max(max, p.order), 0) + 1
    const project: StoredProject = {
      id: input.id,
      root: input.root,
      label: input.label,
      order,
      trusted: false,
      addedAt: new Date().toISOString(),
    }
    await this.write([...current, project])
    return project
  }

  /** Remove a project from the catalog. Never deletes repository data. */
  remove(id: string): Promise<boolean> {
    return this.run(() => this.doRemove(id))
  }

  private async doRemove(id: string): Promise<boolean> {
    const current = this.fresh()
    const next = current.filter((p) => p.id !== id)
    if (next.length === current.length) return false
    await this.write(next)
    return true
  }

  setTrusted(id: string, trusted: boolean): Promise<boolean> {
    return this.run(() => this.doSetTrusted(id, trusted))
  }

  private async doSetTrusted(id: string, trusted: boolean): Promise<boolean> {
    const current = this.fresh()
    if (!current.find((p) => p.id === id)) return false
    await this.write(current.map((p) => (p.id === id ? { ...p, trusted } : p)))
    return true
  }

  setLabel(id: string, label: string | undefined): Promise<boolean> {
    return this.run(() => this.doSetLabel(id, label))
  }

  private async doSetLabel(id: string, label: string | undefined): Promise<boolean> {
    const current = this.fresh()
    if (!current.find((p) => p.id === id)) return false
    await this.write(current.map((p) => (p.id === id ? { ...p, label } : p)))
    return true
  }
}
