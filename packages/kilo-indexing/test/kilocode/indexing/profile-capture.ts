import { spyOn } from "bun:test"
import type { IndexingProfileRecord } from "../../../src/util/profile"

export async function captureProfiles(run: () => Promise<void>): Promise<IndexingProfileRecord[]> {
  const env = process.env.KILO_INDEXING_PROFILE
  const info = spyOn(console, "info").mockImplementation(() => undefined)
  try {
    process.env.KILO_INDEXING_PROFILE = "1"
    await run()
    const records: IndexingProfileRecord[] = []
    for (const [value] of info.mock.calls) {
      try {
        const record = JSON.parse(String(value)) as { type?: unknown }
        if (record.type === "kilo-indexing-profile") records.push(record as IndexingProfileRecord)
      } catch {
        continue
      }
    }
    return records
  } finally {
    info.mockRestore()
    if (env === undefined) delete process.env.KILO_INDEXING_PROFILE
    else process.env.KILO_INDEXING_PROFILE = env
  }
}
