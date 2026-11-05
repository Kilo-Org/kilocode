import { randomUUID } from "node:crypto"
import { link, mkdir, open, readdir, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { apply, type UpsellAction, type UpsellState } from "../shared/agent-manager-upsell"

/** Authoritative, machine-local preferences shared by extension hosts. No Memento cache. */
export class UpsellPreferences {
  private readonly dir: string

  constructor(storage: string) {
    this.dir = join(storage, "agent-manager-upsell")
  }

  private async latest() {
    const files = await readdir(this.dir).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return []
      throw err
    })
    const revision = files.reduce(
      (max, file) => (/^[1-9]\d*\.json$/.test(file) ? Math.max(max, Number(file.slice(0, -5))) : max),
      0,
    )
    if (!Number.isSafeInteger(revision)) throw new Error("Invalid sidebar upsell revision")
    if (!revision) return { revision, state: {} as UpsellState }
    const state: unknown = JSON.parse(await readFile(join(this.dir, `${revision}.json`), "utf8"))
    if (
      !state ||
      typeof state !== "object" ||
      Array.isArray(state) ||
      Object.entries(state).some(([key, value]) =>
        ["converted", "opened", "optedOut"].includes(key)
          ? typeof value !== "boolean"
          : key === "snoozedAt"
            ? typeof value !== "number" || !Number.isFinite(value)
            : key === "snoozeCount"
              ? typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 3
              : true,
      )
    )
      throw new Error("Invalid sidebar upsell preferences")
    return { revision, state: state as UpsellState }
  }

  async read(): Promise<UpsellState> {
    return (await this.latest()).state
  }

  async update(action: Exclude<UpsellAction, "shown"> | "observed", now: number): Promise<UpsellState> {
    for (;;) {
      const { revision, state } = await this.latest()
      const next = apply(state, action, now)
      // In particular, routine AM opens publish at most one revision, even across hosts.
      if (JSON.stringify(next) === JSON.stringify(state)) return state
      if (!Number.isSafeInteger(revision + 1)) throw new Error("Sidebar upsell revisions exhausted")
      await mkdir(this.dir, { recursive: true, mode: 0o700 })
      const temp = join(this.dir, `.${randomUUID()}.tmp`)
      try {
        const file = await open(temp, "wx", 0o600)
        try {
          await file.writeFile(JSON.stringify(next))
          await file.sync()
        } finally {
          await file.close()
        }
        // link is an atomic no-replace publication of a complete immutable revision.
        // A loser must rebase on the winner. Never delete revisions: that would permit ABA.
        const published = await link(temp, join(this.dir, `${revision + 1}.json`)).then(
          () => true,
          (err: NodeJS.ErrnoException) => {
            if (err.code === "EEXIST") return false
            throw err
          },
        )
        if (published) return next
      } finally {
        // A crashed writer can leave an unpublished temp, but never a lock or partial revision.
        await rm(temp, { force: true })
      }
    }
  }
}
