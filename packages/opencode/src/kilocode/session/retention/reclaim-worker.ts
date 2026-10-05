import { Database } from "bun:sqlite"
import { KiloReclaim } from "./reclaim"

function reclaim(file: string): KiloReclaim.Result {
  const db = new Database(file, { readwrite: true, create: false })
  try {
    // Do not wait behind another writer or change the database's journal mode.
    db.run("PRAGMA busy_timeout = 0")
    db.run("PRAGMA synchronous = NORMAL")
    const page = db
      .query<
        { page_size: number; page_count: number; freelist_count: number },
        []
      >("SELECT page_size, page_count, freelist_count FROM pragma_page_size, pragma_page_count, pragma_freelist_count")
      .get()
    if (!page || !KiloReclaim.worth(page.page_count, page.freelist_count, page.page_size))
      return { vacuumed: false, reclaimedBytes: 0 }
    db.run("VACUUM")
    db.run("PRAGMA wal_checkpoint(TRUNCATE)")
    const after = db.query<{ page_count: number }, []>("PRAGMA page_count").get()
    return {
      vacuumed: true,
      reclaimedBytes: Math.max(0, page.page_count - (after?.page_count ?? page.page_count)) * page.page_size,
    }
  } finally {
    db.close()
  }
}

self.onmessage = (event: MessageEvent<string>) => {
  try {
    self.postMessage({ ok: true, result: reclaim(event.data) } satisfies KiloReclaim.Reply)
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) } satisfies KiloReclaim.Reply)
  } finally {
    self.close()
  }
}
