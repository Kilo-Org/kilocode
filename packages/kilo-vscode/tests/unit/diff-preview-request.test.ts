import { describe, expect, it } from "bun:test"
import path from "node:path"

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
})
