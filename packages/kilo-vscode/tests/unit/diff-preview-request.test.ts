import { describe, expect, it } from "bun:test"
import path from "node:path"
import { build } from "esbuild"
import { solidPlugin } from "esbuild-plugin-solid"

const WEBVIEW = path.resolve(import.meta.dir, "../../webview-ui")
const PASS = "DIFF_PREVIEW_REQUEST_PASS"
const FAIL = "DIFF_PREVIEW_REQUEST_FAIL:"

const SCRIPT = `
  const { createEffect, createRoot, createSignal, on } = await import("solid-js")
  const { createDiffRequests } = await import("./diff-viewer/diff-requests.ts")

  const summary = {
    file: "src/app.ts",
    before: "",
    after: "",
    patch: "",
    additions: 1,
    deletions: 0,
    status: "modified",
    tracked: true,
    generatedLike: false,
    summarized: true,
    stamp: "1:1",
  }

  const fail = (reason) => {
    console.log("${FAIL}" + reason)
    process.exit(2)
  }

  const requested = []
  const [key, setKey] = createSignal("review-1")
  const [diffs, setDiffs] = createSignal([summary])
  const [open, setOpen] = createSignal([])
  const dispose = createRoot((dispose) => {
    let initialized
    createEffect(
      on(
        () => [key(), diffs()],
        ([next, items]) => {
          if (next === initialized || items.length === 0) return
          initialized = next
          setOpen(items.map((item) => item.file))
        },
      ),
    )
    createDiffRequests({
      key,
      diffs,
      open,
      loading: () => undefined,
      send: () => (file) => requested.push(file),
    })
    return dispose
  })

  await new Promise((resolve) => setTimeout(resolve, 0))
  if (requested.length !== 1 || requested[0] !== summary.file) {
    fail("initial summarized diff requested " + JSON.stringify(requested))
  }

  setDiffs([{ ...summary }])
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (requested.length !== 1) {
    fail("unchanged summarized diff requested again " + JSON.stringify(requested))
  }

  setOpen([])
  await new Promise((resolve) => setTimeout(resolve, 0))
  setOpen([summary.file])
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (requested.length !== 2) {
    fail("reopened summarized diff did not retry " + JSON.stringify(requested))
  }

  setKey("review-2")
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (requested.length !== 3) {
    fail("new review did not request the same diff token " + JSON.stringify(requested))
  }
  dispose()

  const blocked = []
  const [loading, setLoading] = createSignal(new Set([summary.file]))
  const disposeBlocked = createRoot((dispose) => {
    createDiffRequests({
      key: () => "review-3",
      diffs,
      open: () => [summary.file],
      loading,
      send: () => (file) => blocked.push(file),
    })
    return dispose
  })

  await new Promise((resolve) => setTimeout(resolve, 0))
  if (blocked.length !== 0) fail("requested a diff that was already loading")
  setLoading(new Set())
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (blocked.length !== 1 || blocked[0] !== summary.file) {
    fail("did not request after existing loading state cleared " + JSON.stringify(blocked))
  }
  disposeBlocked()

  const lazy = []
  const entries = Array.from({ length: 85 }, (_, index) => ({
    ...summary,
    file: "src/file-" + index + ".ts",
  }))
  let request
  const disposeLazy = createRoot((dispose) => {
    request = createDiffRequests({
      key: () => "review-lazy",
      diffs: () => entries,
      open: () => entries.map((item) => item.file),
      loading: () => undefined,
      send: () => (file) => lazy.push(file),
      eager: false,
    })
    return dispose
  })

  await new Promise((resolve) => setTimeout(resolve, 0))
  if (lazy.length !== 0) fail("offscreen diffs requested eagerly " + JSON.stringify(lazy))
  request(entries[0])
  request(entries[1])
  request(entries[0], () => { throw new Error("Repeated requests must not measure layout") })
  request(entries[80], () => false)
  if (lazy.length !== 2 || lazy[0] !== entries[0].file || lazy[1] !== entries[1].file) {
    fail("visible diff requests were not lazy and deduplicated " + JSON.stringify(lazy))
  }
  request(entries[80])
  if (lazy.length !== 3 || lazy[2] !== entries[80].file) {
    fail("newly mounted distant diff was not requested " + JSON.stringify(lazy))
  }
  disposeLazy()

  const { mergeWorktreeDiffs, resolveDiffFile } = await import("./diff-viewer/diff-state.ts")
  const retried = []
  const [results, setResults] = createSignal([summary])
  const [pending, setPending] = createSignal(new Set())
  let retry
  const release = createRoot((dispose) => {
    retry = createDiffRequests({
      key: () => "review-retry",
      diffs: results,
      open: () => [summary.file],
      loading: pending,
      send: () => (file) => {
        retried.push(file)
        setPending(new Set([file]))
      },
    })
    return dispose
  })
   if (retried.length !== 1 || !pending().has(summary.file)) fail("initial detail was not requested")
   setPending(new Set())
   if (retried.length !== 2 || !pending().has(summary.file)) fail("cancelled detail was not requested again")
   setResults(resolveDiffFile(results(), summary.file, null))
   setPending(new Set())
   setResults(mergeWorktreeDiffs(results(), [{ ...summary }]).diffs)
   retry(results().at(0))
   if (retried.length !== 2 || !results().at(0).failed) fail("failed detail retried automatically")
   retry(results().at(0), undefined, true)
   retry(results().at(0), undefined, true)
   if (retried.length !== 3 || !pending().has(summary.file)) fail("explicit retry was not deduplicated")
   if (!results().at(0).failed) fail("retry hid failed fallback comments")
   setResults(resolveDiffFile(results(), summary.file, { ...summary }))
   setPending(new Set())
   if (retried.length !== 3) fail("another summary started an automatic retry loop")
   retry(results().at(0), undefined, true)
   setResults(resolveDiffFile(results(), summary.file, { ...summary, after: "loaded", summarized: false }))
   setPending(new Set())
   if (retried.length !== 4 || results().at(0).failed || results().at(0).summarized) fail("successful retry did not settle")
  release()
  console.log("${PASS}")
`

describe("diff preview detail requests", () => {
  it("requests detail when summarized diffs are present on first render", () => {
    const result = Bun.spawnSync(["bun", "--conditions=browser", "-e", SCRIPT], {
      cwd: WEBVIEW,
      stdout: "pipe",
      stderr: "pipe",
    })
    const output = result.stdout.toString() + result.stderr.toString()
    const logic = output.indexOf(FAIL)

    if (logic !== -1) {
      expect.unreachable(
        output
          .slice(logic + FAIL.length)
          .split("\n")[0]
          ?.trim(),
      )
    }
    expect(result.exitCode, output).toBe(0)
    expect(output).toContain(PASS)
  })

  it("discards cancelled standalone details and recovers real failures through the message handler", async () => {
    const solid = path.dirname(Bun.resolveSync("solid-js/package.json", WEBVIEW))
    const result = await build({
      stdin: {
        contents: `
          import assert from "node:assert/strict"
          import { createRoot } from "solid-js"
          import { SourceController } from "../src/diff/SourceController"
          import { DiffViewerApp } from "./diff-viewer/DiffViewerApp"
          import { state } from "probe:surface"
          globalThis.window = new EventTarget()
          const dispose = createRoot((dispose) => { DiffViewerApp({}); return dispose })
          const summary = { file: "a.ts", before: "", after: "", additions: 1, deletions: 0, summarized: true }
          const entered = Promise.withResolvers()
          const wait = Promise.withResolvers()
          const current = () => state.view.diffs.at(0)
          const controller = new SourceController((id) => ({
            descriptor: { id, type: "workspace", group: "Git", capabilities: { comments: true, revert: true } },
            fetch: async () => ({ diffs: [{ ...summary }] }),
            fetchFile: async () => { entered.resolve(); await wait.promise; return null },
          }), () => [], state.receive)
          controller.setContext({ workspaceRoot: "/repo" })
          void (async () => {
            await controller.activate("workspace", { poll: false })
            state.view.onRequestDiff(summary.file)
            const pending = controller.requestFile(summary.file)
            await entered.promise
            state.receive({ type: "diffViewer.loading", loading: true })
            assert.equal(state.view.loadingFiles.has(summary.file), true)
            await controller.activate("workspace", { poll: false })
            assert.equal(state.view.loadingFiles.size, 0)
            state.view.onRequestDiff(summary.file)
            wait.resolve()
            await pending
            assert.equal(current().failed, undefined)
            assert.equal(state.view.loadingFiles.has(summary.file), true)
            await controller.requestFile(summary.file)
            assert.equal(current().failed, true)
            assert.equal(state.view.loadingFiles.size, 0)
            state.receive({ type: "diffViewer.diffs", diffs: [{ ...summary }] })
            assert.equal(current().failed, true)
            state.view.onRequestDiff(summary.file)
            state.receive({
              type: "diffViewer.diffFile", file: summary.file,
              diff: { ...summary, after: "loaded", summarized: false },
            })
            assert.equal(current().failed, undefined)
            assert.equal(current().after, "loaded")
            assert.equal(state.view.loadingFiles.size, 0)
            controller.dispose()
            dispose()
          })().catch((err) => { console.error(err); process.exitCode = 1 })
        `,
        resolveDir: WEBVIEW,
        sourcefile: "detail-recovery.ts",
        loader: "ts",
      },
      bundle: true,
      platform: "node",
      format: "cjs",
      write: false,
      logLevel: "silent",
      plugins: [
        {
          name: "review-surface",
          setup(ctx) {
            ctx.onResolve({ filter: /^solid-js$/ }, () => ({ path: path.join(solid, "dist/solid.js") }))
            ctx.onResolve({ filter: /^solid-js\/web$/ }, () => ({ path: path.join(solid, "web/dist/server.js") }))
            ctx.onResolve({ filter: /.*/ }, (args) => {
              if (
                args.path !== "probe:surface" &&
                (!args.importer.endsWith("/DiffViewerApp.tsx") || ["solid-js", "./diff-state"].includes(args.path))
              )
                return
              return { path: "surface", namespace: "probe" }
            })
            ctx.onLoad({ filter: /.*/, namespace: "probe" }, () => ({
              contents: `
                export const state = { posted: [] }
                export const useVSCode = () => ({ onMessage(receive) { state.receive = receive; return () => {} } })
                export const getVSCodeAPI = () => ({ postMessage: (message) => state.posted.push(message) })
                export const useLanguage = () => ({ t: (key) => key })
                export const useServer = () => ({})
                export const FullScreenDiffView = (props) => { state.view = props; return "" }
                export const Toast = { Region: () => "" }
                ${[
                  "DialogProvider",
                  "CodeComponentProvider",
                  "DiffComponentProvider",
                  "FileComponentProvider",
                  "MarkedProvider",
                  "ThemeProvider",
                  "LanguageProvider",
                  "ServerProvider",
                  "ConfigProvider",
                  "ProviderProvider",
                  "VSCodeProvider",
                  "SpeechToTextModelsProvider",
                  "SpeechToTextPrewarm",
                  "Code",
                  "Diff",
                  "File",
                  "Icon",
                  "DiffPickerHeader",
                  "BaseBranchPicker",
                ]
                  .map((name) => `export const ${name} = (props) => props.children`)
                  .join("\n")}
              `,
              loader: "js",
            }))
          },
        },
        solidPlugin({ solid: { generate: "ssr" } }),
      ],
    })
    const child = Bun.spawnSync(["bun", "-e", result.outputFiles.at(0)!.text], {
      cwd: WEBVIEW,
      stdout: "pipe",
      stderr: "pipe",
    })
    expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0)
  })
})
