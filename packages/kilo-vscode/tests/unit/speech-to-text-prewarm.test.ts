import { describe, expect, it } from "bun:test"
import path from "node:path"

// Run from webview-ui so the child transpiles JSX with solid-js (its tsconfig sets
// jsxImportSource: solid-js). The package root tsconfig has no jsx setting, which makes
// bun fall back to react/jsx-dev-runtime and fail whenever react isn't hoisted nearby.
const WEBVIEW = path.resolve(import.meta.dir, "../../webview-ui")

// solid-js effects only run under the browser export condition, so the component has to be
// exercised in a child process resolved with `--conditions=browser`. The child prints an
// explicit PASS/FAIL sentinel: a FAIL means the prewarm logic is wrong (fail immediately),
// while any other non-zero exit is a transient spawn failure under load and is retried so
// the suite stays deterministic.
const PASS = "PREWARM_PASS"
const FAIL = "PREWARM_FAIL:"

const SCRIPT = `
  import { Window } from "happy-dom"

  const window = new Window()
  globalThis.window = window
  globalThis.document = window.document
  globalThis.Node = window.Node

  const sent = []
  globalThis.acquireVsCodeApi = () => ({
    postMessage: (message) => sent.push(message),
    getState: () => undefined,
    setState: () => {},
  })

  const { createComponent, createSignal } = await import("solid-js")
  const { render } = await import("solid-js/web")
  const { ConfigContext } = await import("./src/context/config.tsx")
  const { ProviderContext } = await import("./src/context/provider.tsx")
  const { SpeechToTextPrewarm } = await import(
    "./src/components/speech-to-text/SpeechToTextPrewarm.tsx"
  )

  const fail = (reason) => {
    console.log("${FAIL}" + reason)
    process.exit(2)
  }

  const [config, setConfig] = createSignal({ disabled_providers: ["kilo"] })
  const [auth, setAuth] = createSignal({})
  const root = document.createElement("div")
  const dispose = render(
    () =>
      createComponent(ProviderContext.Provider, {
        value: { authStates: auth },
        get children() {
          return createComponent(ConfigContext.Provider, {
            value: { config },
            get children() {
              return createComponent(SpeechToTextPrewarm, {})
            },
          })
        },
      }),
    root,
  )

  if (sent.length !== 0) fail("prewarmed without Kilo access")
  setAuth({ kilo: "api" })
  if (sent.length !== 0) fail("prewarmed while Kilo was disabled")
  setConfig({})
  if (sent.length !== 1 || sent[0]?.type !== "speechToTextPrewarm") {
    fail("did not prewarm after Kilo access became available")
  }
  setAuth({ kilo: "oauth" })
  if (sent.length !== 1) fail("prewarmed more than once")
  dispose()
  console.log("${PASS}")
`

describe("speech-to-text prewarm", () => {
  it("starts only after Kilo speech access becomes available", () => {
    const attempts = 3
    const failures: string[] = []

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const result = Bun.spawnSync(["bun", "--conditions=browser", "-e", SCRIPT], {
        cwd: WEBVIEW,
        stdout: "pipe",
        stderr: "pipe",
      })
      const output = result.stdout.toString() + result.stderr.toString()

      if (output.includes(PASS)) return

      const logic = output.indexOf(FAIL)
      // A FAIL sentinel is a real assertion failure in the prewarm logic — surface it now.
      if (logic !== -1) {
        expect.unreachable(output.slice(logic + FAIL.length).split("\n")[0]?.trim())
      }

      // Otherwise the child died before it could run (starved/transient spawn) — retry.
      failures.push(`attempt ${attempt} exit ${result.exitCode}: ${output.trim() || "<no output>"}`)
    }

    expect.unreachable(`prewarm child never reported success:\n${failures.join("\n")}`)
  })
})
