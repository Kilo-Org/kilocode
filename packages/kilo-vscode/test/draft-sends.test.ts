// A draft's sends start one at a time: the first creates the session, and a send pressed while it runs adopts that
// session instead of creating another. The press also pins the session, so a tab switch during the wait cannot move
// the queued prompt into another conversation.
import { describe, expect, test } from "bun:test"
import { createDraftSends } from "../webview-ui/src/v2/draft-sends"

function gate() {
  let release!: () => void
  const opened = new Promise<void>((resolve) => (release = resolve))
  return { opened, release }
}

describe("draft sends", () => {
  test("a second send of a new draft waits and adopts the session the first created", async () => {
    const sends = createDraftSends()
    const seen: Array<string | undefined> = []
    const first = gate()
    const one = sends.run("draft_1", undefined, async (existing) => {
      seen.push(existing)
      await first.opened
      return { id: "ses_new" }
    })
    const two = sends.run("draft_1", undefined, async (existing) => {
      seen.push(existing)
      return { id: existing ?? "ses_other" }
    })

    await Promise.resolve()
    expect(seen).toEqual([undefined])
    first.release()

    expect(await one).toEqual({ id: "ses_new" })
    expect(await two).toEqual({ id: "ses_new" })
    expect(seen).toEqual([undefined, "ses_new"])
  })

  test("a queued send keeps the session it was pressed in after the wait", async () => {
    const sends = createDraftSends()
    const seen: Array<string | undefined> = []
    const first = gate()
    const one = sends.run("ses_a", "ses_a", async (existing) => {
      seen.push(existing)
      await first.opened
      return { id: existing! }
    })
    const two = sends.run("ses_a", "ses_a", async (existing) => {
      seen.push(existing)
      return { id: existing! }
    })

    first.release()
    expect(await one).toEqual({ id: "ses_a" })
    expect(await two).toEqual({ id: "ses_a" })
    expect(seen).toEqual(["ses_a", "ses_a"])
  })

  test("a failed send releases the next one", async () => {
    const sends = createDraftSends()
    const one = sends.run("draft_2", undefined, async () => {
      throw new Error("boom")
    })
    const two = sends.run("draft_2", undefined, async (existing) => ({ id: existing ?? "ses_second" }))

    await expect(one).rejects.toThrow("boom")
    expect(await two).toEqual({ id: "ses_second" })
  })
})
