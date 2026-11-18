// Run explicitly: bun test ./test/browser/playwright-live.ts
// Requires a browser found by the Playwright backend; the default package suite does not install one.
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { NeedsPermissionError, type BrowserBackend } from "../../src/browser/backend"
import { decode, type Image } from "../../src/browser/png"
import { resolve } from "../../src/browser/settings"

let root: string
let output: string
let backend: BrowserBackend
const env = new Map<string, string | undefined>()

beforeAll(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "kilo-playwright-live-")))
  for (const name of ["XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "OPENCODE_TEST_HOME"]) {
    env.set(name, process.env[name])
    process.env[name] = path.join(root, name)
  }
  env.set("PLAYWRIGHT_BROWSERS_PATH", process.env.PLAYWRIGHT_BROWSERS_PATH)
})

beforeEach(async () => {
  const { key, outputDirectory, playwright } = await import("../../src/browser/playwright")
  output = outputDirectory()
  // Fail before launching if another test already imported the global paths outside this fixture.
  expect(output).toStartWith(path.join(root, "XDG_DATA_HOME") + path.sep)
  backend = await playwright.get(key(resolve({ headless: true })))
})

afterEach(async () => {
  const { playwright } = await import("../../src/browser/playwright")
  await playwright.dispose()
})

afterAll(async () => {
  for (const [name, value] of env) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  if (root) await fs.rm(root, { recursive: true, force: true })
})

function serve(html: string) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(`<!doctype html>${html}`, { headers: { "content-type": "text/html" } }),
  })
}

test("refuses a file URL without navigating or creating a tab", async () => {
  using fixture = serve("<title>Fixture</title><h1>Stay here</h1>")
  const file = path.join(root, "local.html")
  await Bun.write(file, "<!doctype html><h1>Local fixture document</h1>")
  const url = pathToFileURL(file).href
  const ctx = { session: "refusal", authorized: [`navigate:${fixture.url.origin}`, `read:${fixture.url.origin}`] }
  expect((await backend.callTool("browser_navigate", { url: fixture.url.href }, ctx)).isError).toBe(false)
  const tabs = await backend.callTool("browser_tabs", { action: "list" }, ctx)
  await expect(backend.callTool("browser_navigate", { url }, ctx)).rejects.toThrow("Navigation refused: file:")
  await expect(backend.callTool("browser_tabs", { action: "new", url }, ctx)).rejects.toThrow(
    "Navigation refused: file:",
  )
  expect(await backend.callTool("browser_tabs", { action: "list" }, ctx)).toEqual(tabs)
})

// Three live element inspections, a real fill, and two snapshots can exceed Bun's unit test budget.
test("leaves a sensitive field untouched until the exact step is approved", async () => {
  using fixture = serve(`
    <input type="password" aria-label="Password" id="secret">
    <h1 id="status">Inputs: 0</h1>
    <script>
      let count = 0
      document.querySelector('#secret').addEventListener('input', () => {
        document.querySelector('#status').textContent = 'Inputs: ' + ++count
      })
    </script>`)
  const origin = fixture.url.origin
  const ctx = { session: "sensitive", authorized: [`navigate:${origin}`, `read:${origin}`, `act:${origin}`] }
  expect((await backend.callTool("browser_navigate", { url: fixture.url.href }, ctx)).isError).toBe(false)
  const args = { target: "#secret", text: "fixture-value" }
  const request = await backend.callTool("browser_type", args, ctx).catch((error: unknown) => error)
  if (!(request instanceof NeedsPermissionError) || !request.stepToken) throw new Error("Expected a step approval")
  expect(request.items).toEqual([{ class: "sensitive", origin, reason: "password field" }])
  const approved = { ...ctx, sensitive: [request.stepToken] }
  await expect(backend.callTool("browser_type", { ...args, text: "different-value" }, approved)).rejects.toThrow(
    NeedsPermissionError,
  )
  const before = await backend.callTool("browser_snapshot", {}, ctx)
  expect(before.content[0]).toMatchObject({ type: "text", text: expect.stringContaining('heading "Inputs: 0"') })
  expect((await backend.callTool("browser_type", args, approved)).isError).toBe(false)
  const after = await backend.callTool("browser_snapshot", {}, ctx)
  expect(after.content[0]).toMatchObject({ type: "text", text: expect.stringContaining('heading "Inputs: 1"') })
}, 15_000)

function pixel(image: Image, x: number, y: number) {
  const start = (y * image.width + x) * image.channels
  return [...image.data.subarray(start, start + 3)]
}

test("masks withheld frame pixels in both the inline screenshot and the linked file", async () => {
  using frame = serve('<body style="margin:0;background:#ff0000">')
  using fixture = serve(`
    <body style="margin:0;background:#0000ff">
      <iframe src="${frame.url.href}" style="display:block;width:120px;height:100px;border:0"></iframe>
    </body>`)
  const origin = fixture.url.origin
  const ctx = { session: "screenshot", authorized: [`navigate:${origin}`, `read:${origin}`] }
  expect((await backend.callTool("browser_navigate", { url: fixture.url.href }, ctx)).isError).toBe(false)

  const shot = await backend.callTool("browser_take_screenshot", { filename: "masked.png" }, ctx)
  expect(shot.isError).toBe(false)
  expect(shot.meta?.withheldFrames).toEqual([frame.url.origin])
  const saved = path.join(output, "masked.png")
  expect(shot.content[0]).toMatchObject({ type: "text", text: expect.stringContaining(`- [Screenshot](${saved})`) })
  const image = shot.content.find((block) => block.type === "image")
  expect(image?.mimeType).toBe("image/png")
  const bytes = Buffer.from(image?.data ?? "", "base64")
  expect(await fs.readFile(saved)).toEqual(bytes)
  expect(pixel(decode(bytes), 10, 10)).toEqual([0, 0, 0])
  expect(pixel(decode(bytes), 150, 10)).toEqual([0, 0, 255])

  const visible = await backend.callTool(
    "browser_take_screenshot",
    { filename: "visible.png" },
    { ...ctx, authorized: [...ctx.authorized, `read:${frame.url.origin}`] },
  )
  expect(visible.isError).toBe(false)
  expect(pixel(decode(await fs.readFile(path.join(output, "visible.png"))), 10, 10)).toEqual([255, 0, 0])
  expect((await fs.readdir(output)).filter((name) => name.endsWith(".png")).sort()).toEqual([
    "masked.png",
    "visible.png",
  ])
})
