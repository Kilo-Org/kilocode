// Pins the synthetic text the CLI persists when it cannot read an attached file. The JetBrains
// client parses this exact shape to render an inline "attachment skipped" notice (see
// `SessionModel.notice` in packages/kilo-jetbrains). The text is produced by shared upstream code,
// so an upstream rewording must fail here instead of silently hiding the notice again.
import path from "path"
import os from "os"
import fs from "fs/promises"
import { pathToFileURL } from "url"
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Log from "@opencode-ai/core/util/log"
import { AppRuntime } from "../../src/effect/app-runtime"
import { makeRuntime } from "../../src/effect/run-service"
import { Session } from "../../src/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageV2 } from "../../src/session/message-v2"
import { disposeTestRuntime, provideInstance, provideTestInstance, testInstanceStoreLayer, tmpdir } from "../fixture/fixture"
import { remove as cleanup } from "./cleanup"

Log.init({ print: false })
setDefaultTimeout(15_000)

const previous = Flag.KILO_DB
const dbfile = path.join(os.tmpdir(), `kilo-attachment-read-failure-${process.pid}-${crypto.randomUUID()}.db`)
const layer = LayerNode.compile(LayerNode.group([Session.node, SessionProjector.node]))
const prompt = LayerNode.compile(LayerNode.group([SessionPrompt.node, SessionProjector.node]))
const runtime = makeRuntime(Session.Service, layer)

beforeAll(async () => {
  await fs.rm(dbfile, { force: true })
  Flag.KILO_DB = dbfile
})

afterAll(async () => {
  await runtime.dispose()
  await AppRuntime.dispose()
  await disposeTestRuntime()
  Flag.KILO_DB = previous
  await Promise.all([dbfile, `${dbfile}-wal`, `${dbfile}-shm`].map(cleanup))
})

function scoped<T>(dir: string, fn: (svc: SessionPrompt.Interface) => Promise<T>) {
  return Effect.runPromise(
    SessionPrompt.Service.use((svc) => Effect.promise(() => fn(svc))).pipe(
      Effect.provide(prompt),
      provideInstance(dir),
      Effect.provide(testInstanceStoreLayer),
      Effect.scoped,
    ),
  )
}

test("persists the read-failure text shape the JetBrains notice parser expects", async () => {
  await using tmp = await tmpdir({ git: true })
  const file = path.join(tmp.path, "trace.jfr")
  await fs.writeFile(file, Buffer.from([0, 1, 2, 0, 255, 0, 3, 0, 4, 0]))

  await provideTestInstance({
    directory: tmp.path,
    fn: async () =>
      scoped(tmp.path, async (svc) => {
        const session = await runtime.runPromise((s) => s.create({}))
        // The JetBrains client sends non-image files as a text/plain file reference.
        await Effect.runPromise(
          svc.prompt({
            sessionID: session.id,
            agent: "code",
            noReply: true,
            parts: [
              { type: "text", text: "profile attached" },
              { type: "file", mime: "text/plain", url: pathToFileURL(file).href, filename: "trace.jfr" },
            ],
          }),
        )

        const stored = await runtime.runPromise((s) => s.messages({ sessionID: session.id }))
        const texts = stored
          .flatMap((msg) => msg.parts)
          .filter((part): part is MessageV2.TextPart => part.type === "text" && part.synthetic === true)
          .map((part) => part.text)
        const failure = texts.find((text) => text.startsWith("Read tool failed to read "))

        expect(failure).toBeDefined()
        expect(failure?.startsWith(`Read tool failed to read ${file} with the following error: `)).toBe(true)
      }),
  })
})
