import { expect } from "bun:test"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Layer } from "effect"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { preparePluginDependencies } from "./plugin-dependencies"

void Log.init({ print: false })

const state = Layer.effectDiscard(
  Effect.acquireRelease(
    Effect.promise(() => resetDatabase()),
    () => Effect.promise(() => resetDatabase()),
  ),
)

const it = testEffect(Layer.mergeAll(state, FSUtil.defaultLayer))

function writePlugin(dir: string) {
  return Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    yield* Effect.promise(() => preparePluginDependencies(dir))

    yield* fs.writeWithDirs(
      path.join(dir, ".kilo", "plugin", "provider-oauth-reject.ts"),
      [
        "export default {",
        '  id: "test.provider-oauth-reject",',
        "  server: async () => ({",
        "    auth: {",
        '      provider: "test-oauth-reject",',
        "      methods: [",
        "        {",
        '          type: "oauth",',
        '          label: "OAuth",',
        "          authorize: async () => {",
        '            throw new Error("Too many pending authorization requests. Please try again later.")',
        "          },",
        "        },",
        "      ],",
        "    },",
        "  }),",
        "}",
        "",
      ].join("\n"),
    )
  })
}

function authorize(input: { app: ReturnType<typeof Server.Default>["app"]; dir: string }) {
  return Effect.promise(async () => {
    const response = await input.app.request("/provider/test-oauth-reject/oauth/authorize", {
      method: "POST",
      headers: { "x-kilo-directory": input.dir, "content-type": "application/json" },
      body: JSON.stringify({ method: 0 }),
    })
    return {
      status: response.status,
      body: await response.json(),
    }
  })
}

it.instance(
  "returns plugin OAuth authorize rejection messages",
  Effect.gen(function* () {
    const instance = yield* TestInstance
    yield* writePlugin(instance.directory)
    const response = yield* authorize({ app: Server.Default().app, dir: instance.directory })

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      name: "BadRequest",
      data: { message: "Too many pending authorization requests. Please try again later." },
    })
  }),
  { config: { formatter: false, lsp: false } },
  30000,
)
