import { afterEach, describe, expect, test } from "bun:test"
import { Config } from "@opencode/core/config"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Document } from "@opencode/schema/config"
import { Tool } from "@opencode/schema/tool"
import { Effect, Exit, Scope } from "effect"
import { UNAVAILABLE_MESSAGE } from "../../src/browser/backend"
import { BrowserContract } from "../../src/browser/contract"
import { KiloBrowserToolsPlugin } from "../../src/browser/tools"

type Browser = NonNullable<KiloConfigPolicy.BrowserConfig>

const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

/** The plugin against a stand-in tool editor and a config document holding one `browser` block. */
async function boot(browser?: Browser) {
  const transforms: ((editor: { add: (tool: Tool.Info) => void }) => void)[] = []
  const ctx = {
    tool: {
      transform: (fn: (typeof transforms)[number]) => Effect.sync(() => (transforms.push(fn), { dispose: Effect.void })),
    },
  }
  const config = {
    entries: () =>
      Effect.succeed(
        browser === undefined
          ? []
          : [new Document({ type: "document", info: new KiloConfigPolicy.Info({ browser }) })],
      ),
  } as unknown as Config.Interface
  const scope = await Effect.runPromise(Scope.make())
  closers.push(() => Effect.runPromise(Scope.close(scope, Exit.void)))
  await Effect.runPromise(
    KiloBrowserToolsPlugin.effect(ctx as never).pipe(
      Effect.provideService(Scope.Scope, scope),
      Effect.provideService(Config.Service, config),
    ),
  )
  const tools = () => {
    const added: Tool.Info[] = []
    transforms.forEach((fn) => fn({ add: (tool) => added.push(tool) }))
    return added
  }
  const call = (name: string, input: unknown = {}) =>
    Effect.runPromise(
      Effect.result(
        tools()
          .find((tool) => tool.name === name)!
          .execute(input, {
            sessionID: "ses_browser" as never,
            agent: "code" as never,
            messageID: "msg_browser" as never,
            id: "call_browser" as never,
            progress: () => Effect.void,
          }),
      ),
    )
  return { tools, call }
}

describe("browser tools", () => {
  test("registers the whole pinned contract with the vendored schemas", async () => {
    const host = await boot()
    const tools = host.tools()
    expect(tools.map((tool) => tool.name)).toEqual(BrowserContract.entries.map((entry) => entry.name))
    expect(tools.length).toBe(26)
    for (const [index, tool] of tools.entries()) {
      const entry = BrowserContract.entries[index]
      expect(tool.description).toBe(entry.description)
      expect(tool.input).toEqual(entry.inputSchema)
      // Direct tools: the model calls `browser_click`, not a Code Mode wrapper.
      expect(tool.options).toEqual({ codemode: false })
    }
  })

  test("backend off hides every browser tool", async () => {
    const host = await boot({ backend: "off" })
    expect(host.tools()).toEqual([])
  })

  test("an absent browser block keeps the tools on the default backend", async () => {
    const host = await boot()
    expect(host.tools().length).toBe(26)
  })

  test("the extension backend answers every call with the model-facing unavailable error and a hint", async () => {
    const host = await boot({ backend: "extension" })
    const result = await host.call("browser_click", { target: "e1" })
    expect(result._tag).toBe("Failure")
    const error = result._tag === "Failure" ? (result.failure as Tool.Error) : undefined
    expect(error?.message).toBe(UNAVAILABLE_MESSAGE)
    expect(String(error?.metadata?.hint)).toContain("Kilo browser extension")
  })
})
