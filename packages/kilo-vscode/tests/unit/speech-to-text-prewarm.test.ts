import { describe, expect, it } from "bun:test"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")

describe("speech-to-text prewarm", () => {
  it("starts only after Kilo speech access becomes available", () => {
    const result = Bun.spawnSync(
      [
        "bun",
        "--conditions=browser",
        "-e",
        `
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
          const { ConfigContext } = await import("./webview-ui/src/context/config.tsx")
          const { ProviderContext } = await import("./webview-ui/src/context/provider.tsx")
          const { SpeechToTextPrewarm } = await import(
            "./webview-ui/src/components/speech-to-text/SpeechToTextPrewarm.tsx"
          )

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

          if (sent.length !== 0) throw new Error("prewarmed without Kilo access")
          setAuth({ kilo: "api" })
          if (sent.length !== 0) throw new Error("prewarmed while Kilo was disabled")
          setConfig({})
          if (sent.length !== 1 || sent[0]?.type !== "speechToTextPrewarm") {
            throw new Error("did not prewarm after Kilo access became available")
          }
          setAuth({ kilo: "oauth" })
          if (sent.length !== 1) throw new Error("prewarmed more than once")
          dispose()
        `,
      ],
      { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
    )

    const output = result.stdout.toString() + result.stderr.toString()
    expect(result.exitCode, output).toBe(0)
  })
})
