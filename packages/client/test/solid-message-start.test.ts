// kilocode_change start
import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createData, type CreateDataInput } from "../src/solid"
import { OpenCode } from "../src/promise"

// The server always returns a next cursor for the last non-empty page, so the client tracks whether that page was
// shorter than the limit. The VS Code transcript hides Load earlier when the loaded page reaches the start.
test("a short first page reports that the transcript start is loaded", async () => {
  const setup = fixture([{ data: [message("msg_2"), message("msg_1")], next: "older" }])
  try {
    await setup.data.session.message.sync("ses_one")

    expect(setup.data.session.message.more("ses_one")).toBe(true)
    expect(setup.data.session.message.startLoaded("ses_one")).toBe(true)
  } finally {
    setup.dispose()
  }
})

test("a full first page needs the next short page before the start counts as loaded", async () => {
  const full = Array.from({ length: 20 }, (_, index) => message(`msg_${index}`))
  const setup = fixture([{ data: full, next: "older" }, { data: [] }])
  try {
    await setup.data.session.message.sync("ses_one")
    expect(setup.data.session.message.startLoaded("ses_one")).toBe(false)

    await setup.data.session.message.loadMore("ses_one")
    expect(setup.data.session.message.startLoaded("ses_one")).toBe(true)
    expect(setup.data.session.message.more("ses_one")).toBe(false)
  } finally {
    setup.dispose()
  }
})

test("an evicted session forgets the loaded start", async () => {
  const setup = fixture([{ data: [message("msg_1")] }])
  try {
    await setup.data.session.message.sync("ses_one")
    setup.data.session.message.evict("ses_one")

    expect(setup.data.session.message.startLoaded("ses_one")).toBe(false)
  } finally {
    setup.dispose()
  }
})

function message(id: string) {
  return { id, type: "user" as const, text: id, time: { created: 0 } }
}

function fixture(pages: Array<{ data: ReturnType<typeof message>[]; next?: string }>) {
  let page = 0
  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (!url.pathname.endsWith("/message")) return Response.json({})
      const current = pages[Math.min(page++, pages.length - 1)] ?? { data: [] }
      return Response.json({ data: current.data, cursor: current.next ? { next: current.next } : {} })
    },
  })
  return createRoot((dispose) => {
    const data = createData({
      api: () => api,
      directory: "/project",
      event: {
        on: () => () => {},
        listen: () => () => {},
      } satisfies CreateDataInput["event"],
    })
    return { data, dispose }
  })
}
// kilocode_change end
