import { afterAll, afterEach, beforeEach, expect, jest, test } from "bun:test"
import path from "node:path"
import { build } from "esbuild"
import { Window } from "happy-dom"
import type { Component, createComponent, createSignal } from "solid-js"
import type { render } from "solid-js/web"
import { createSolidPlugin } from "../script/solid-cache"

const root = path.resolve(import.meta.dir, "..")
const webview = path.join(root, "webview-ui")
const solid = path.dirname(Bun.resolveSync("solid-js/package.json", webview))
// Bundle the harness and component together so rendering and cleanup share the client Solid runtime.
const bundle = await build({
  stdin: {
    contents: `
      export { createComponent, createSignal } from "solid-js"
      export { render } from "solid-js/web"
      export { TranscriptLoading } from "./src/v2/transcript-loading"
    `,
    resolveDir: webview,
  },
  alias: {
    "solid-js": path.join(solid, "dist/solid.js"),
    "solid-js/web": path.join(solid, "web/dist/web.js"),
  },
  bundle: true,
  format: "esm",
  loader: { ".css": "empty" },
  plugins: [createSolidPlugin({ root })],
  write: false,
})
const source = Buffer.from(bundle.outputFiles[0]!.contents).toString("base64")
// SAFETY: The bundle preserves the named exports from the entrypoint above.
const runtime = (await import(`data:text/javascript;base64,${source}`)) as {
  createComponent: typeof createComponent
  createSignal: typeof createSignal
  render: typeof render
  TranscriptLoading: Component<{ session?: string; label: string }>
}

const label = "Loading messages"
const viewWindow = new Window()
const globals = new Map<"document" | "IntersectionObserver", PropertyDescriptor | undefined>()
beforeEach(() => {
  for (const key of ["document", "IntersectionObserver"] as const) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, value: viewWindow[key] })
  }
  jest.useFakeTimers()
})
afterEach(() => {
  jest.useRealTimers()
  for (const [key, descriptor] of globals) {
    if (!descriptor) {
      delete (globalThis as Partial<typeof globalThis>)[key]
      continue
    }
    Object.defineProperty(globalThis, key, descriptor)
  }
  globals.clear()
})
afterAll(() => viewWindow.happyDOM.close())

function mount() {
  const host = document.createElement("div")
  const [session, setSession] = runtime.createSignal<string>()
  const dispose = runtime.render(
    () =>
      runtime.createComponent(runtime.TranscriptLoading, {
        get session() {
          return session()
        },
        label,
      }),
    host,
  )
  return { setSession, status: () => host.querySelector(".message-list-loading"), [Symbol.dispose]: dispose }
}

test("a transcript that loads before 150 ms never shows a placeholder and cancels its timer", () => {
  using view = mount()
  expect(jest.getTimerCount()).toBe(0)
  view.setSession("ses_a")
  jest.advanceTimersByTime(149)
  expect(view.status()).toBeNull()
  view.setSession(undefined)
  expect(jest.getTimerCount()).toBe(0)
  jest.advanceTimersByTime(1)
  expect(view.status()).toBeNull()
})

test("a transcript still loading at 150 ms shows a status until it finishes", () => {
  using view = mount()
  view.setSession("ses_a")
  expect(view.status()).toBeNull()
  jest.advanceTimersByTime(149)
  expect(view.status()).toBeNull()
  jest.advanceTimersByTime(1)
  expect(view.status()?.getAttribute("role")).toBe("status")
  expect(view.status()?.textContent).toBe(label)
  view.setSession(undefined)
  expect(view.status()).toBeNull()
})

test("switching between loading sessions cancels the old timer and starts a fresh 150 ms delay", () => {
  using view = mount()
  view.setSession("ses_a")
  jest.advanceTimersByTime(100)
  view.setSession("ses_b")
  expect(jest.getTimerCount()).toBe(1)
  jest.advanceTimersByTime(149)
  expect(view.status()).toBeNull()
  jest.advanceTimersByTime(1)
  expect(view.status()?.textContent).toBe(label)
})
