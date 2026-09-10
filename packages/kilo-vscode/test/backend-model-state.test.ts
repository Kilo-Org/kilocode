import { expect, test } from "bun:test"
import { Effect } from "effect"
import path from "node:path"
import { fixture } from "../../kilo-cli/test/fixture"
import { launch } from "../../kilo-cli/src/interactive-server"
import { connectV2 } from "../src/connection"
import { createKiloClient, type KiloClient } from "../src/backend"
import { handleMessage, reset } from "../src/kilo-provider/model-state"

test("original model-selection messages persist across host restart without erasing TUI preferences", async () => {
  await using input = await fixture()
  const file = path.join(input.layout.paths.state, "model.json")
  const native = {
    recent: [{ providerID: "fixture", modelID: "recent" }],
    favorite: [{ providerID: "fixture", modelID: "favorite" }],
    variant: { "fixture/recent": "high" },
    extensionField: { retained: true },
  }
  await Bun.write(file, JSON.stringify(native))
  const withHost = (run: (client: KiloClient) => Promise<void>) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const server = yield* launch({ ...input.layout, channel: "interactive" }, { models: false, recover: false })
          const verified = yield* Effect.promise(() => connectV2({ url: server.url, password: server.auth.password }))
          yield* Effect.promise(() => run(createKiloClient({ client: verified.client, directory: input.cwd })))
        }),
      ),
    )

  await withHost(async (client) => {
    const messages: unknown[] = []
    const post = (message: unknown) => messages.push(message)
    expect(await handleMessage("unrelated", {}, client, post)).toBe(false)
    await Promise.all(
      ["build", "ask"].map((agent) =>
        handleMessage("persistModelSelection", { agent, providerID: "fixture", modelID: agent }, client, post),
      ),
    )
    await handleMessage("requestModelSelections", {}, client, post)
    expect(messages).toEqual([
      {
        type: "modelSelectionsLoaded",
        selections: {
          build: { providerID: "fixture", modelID: "build" },
          ask: { providerID: "fixture", modelID: "ask" },
        },
      },
    ])
    expect(await Bun.file(file).json()).toMatchObject(native)
    await expect(
      handleMessage("persistModelSelection", { agent: "build", providerID: "", modelID: "bad" }, client, post),
    ).rejects.toThrow()
    expect((await client.modelState.list()).build).toEqual({ providerID: "fixture", modelID: "build" })
  })

  await withHost(async (client) => {
    expect(await client.modelState.list()).toEqual({
      build: { providerID: "fixture", modelID: "build" },
      ask: { providerID: "fixture", modelID: "ask" },
    })
    const messages: unknown[] = []
    await handleMessage("clearModelSelection", { agent: "build" }, client, (message) => messages.push(message))
    expect(await client.modelState.list()).toEqual({ ask: { providerID: "fixture", modelID: "ask" } })
    await reset(client, (message) => messages.push(message))
    expect(messages).toEqual([{ type: "modelSelectionsLoaded", selections: {} }])
    expect(await Bun.file(file).json()).toEqual({ ...native, model: {} })
    await Bun.write(file, "{malformed")
    await expect(client.modelState.set({ agent: "build", providerID: "fixture", modelID: "new" })).rejects.toThrow()
    expect(await Bun.file(file).text()).toBe("{malformed")
  })
}, 30_000)
