import { describe, expect, it } from "bun:test"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")

describe("task tool index identity", () => {
  it("preserves a rendered child tool row across status updates", () => {
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

          const { Index, createComponent, createRenderEffect } = await import("solid-js")
          const { createStore } = await import("solid-js/store")
          const { render } = await import("solid-js/web")
          const { reconcileSessionToolParts, upsertSessionToolPart } = await import(
            "./webview-ui/src/context/session-utils.ts"
          )

          const running = {
            id: "tool-1",
            type: "tool",
            tool: "read",
            state: { status: "running", input: { filePath: "src/app.ts" }, title: "Reading" },
          }
          const completed = {
            id: "tool-1",
            type: "tool",
            tool: "read",
            state: { status: "completed", input: { filePath: "src/app.ts" }, title: "Read", output: "done" },
          }
          const root = document.createElement("div")
          const [store, setStore] = createStore({ tools: [running] })
          const dispose = render(
            () =>
              createComponent(Index, {
                get each() {
                  return store.tools
                },
                children: (item) => {
                  const row = document.createElement("div")
                  createRenderEffect(() => {
                    row.textContent = item().state.status
                  })
                  return row
                },
              }),
            root,
          )
          const row = root.firstElementChild
          const tools = upsertSessionToolPart(store.tools, completed, { id: "message-1", sessionID: "child-1" })
          setStore("tools", reconcileSessionToolParts(tools))
          if (root.firstElementChild !== row) throw new Error("rendered tool row was replaced")
          if (row?.textContent !== "completed") throw new Error("rendered tool row was not updated")
          dispose()
        `,
      ],
      { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
    )

    const output = result.stdout.toString() + result.stderr.toString()
    expect(result.exitCode, output).toBe(0)
  })
})
