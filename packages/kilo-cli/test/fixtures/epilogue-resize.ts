declare const KILO_BRANDING_COMPILED: boolean

const columns = process.argv.slice(2).map(Number)
if (columns.length < 2 || columns.some((value) => !Number.isInteger(value) || value < 1))
  throw new Error("Pass initial and resized terminal widths")
Object.defineProperty(process.stdout, "columns", { value: columns[0], configurable: true })

if (typeof KILO_BRANDING_COMPILED === "undefined")
  await import(process.env.KILO_BRANDING_TEST_HOSTED === "1" ? "../../src/branding/preload" : "@opentui/solid/preload")

const { createAppFixture } = await import("../../../tui/test/fixture/app")
const { json, directory } = await import("../../../tui/test/fixture/tui-client")
const session = {
  id: "ses_example",
  title: "Review fixture",
  projectID: "project",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
let served = false
const setup = await createAppFixture({
  width: columns[0],
  height: 30,
  args: { sessionID: session.id },
  config: { animations: false, tabs: { mode: "off" } },
  fetch: async (url) => {
    if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
    if (url.pathname === `/api/session/${session.id}`) {
      served = true
      return json({ data: session })
    }
    if (url.pathname === `/api/session/${session.id}/message`) return json({ data: [], cursor: {} })
    if (url.pathname === `/api/session/${session.id}/inbox`) return json({ data: [] })
    if (url.pathname === `/api/session/${session.id}/permission`) return json({ data: [] })
    return undefined
  },
})
try {
  await setup.waitForFrame(() => served, { maxPasses: 100 })
  await setup.flush()
  for (const width of columns.slice(1)) {
    setup.resize(width, 30)
    await setup.waitForFrame(() => setup.renderer.width === width, { maxPasses: 100 })
    await setup.flush()
  }
} finally {
  await setup[Symbol.asyncDispose]()
}
