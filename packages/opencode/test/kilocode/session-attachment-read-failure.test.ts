// Pins the synthetic text the CLI persists when it cannot read an attached file. The JetBrains
// client parses this exact shape to render an inline "attachment skipped" notice (see
// `SessionModel.notice` in packages/kilo-jetbrains). The text is produced by shared upstream code,
// so an upstream rewording must fail here instead of silently hiding the notice again.
import path from "path"
import fs from "fs/promises"
import { pathToFileURL } from "url"
import { afterAll, expect, setDefaultTimeout, test } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import * as Log from "@opencode-ai/core/util/log"
import { Session } from "../../src/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageV2 } from "../../src/session/message-v2"
import { disposeTestRuntime, provideInstance, provideTestInstance, testInstanceStoreLayer, tmpdir } from "../fixture/fixture"

Log.init({ print: false })
setDefaultTimeout(15_000)

// One graph for session storage and prompting, so both read and write the same database.
const layer = LayerNode.compile(LayerNode.group([Session.node, SessionPrompt.node, SessionProjector.node]))

afterAll(async () => {
  await disposeTestRuntime()
})

test("persists the read-failure text shape the JetBrains notice parser expects", async () => {
  await using tmp = await tmpdir({ git: true })
  const file = path.join(tmp.path, "trace.jfr")
  await fs.writeFile(file, Buffer.from([0, 1, 2, 0, 255, 0, 3, 0, 4, 0]))

  const texts = await provideTestInstance({
    directory: tmp.path,
    fn: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const sessions = yield* Session.Service
          const prompt = yield* SessionPrompt.Service
          const session = yield* sessions.create({})
          // The JetBrains client sends non-image files as a text/plain file reference.
          yield* prompt.prompt({
            sessionID: session.id,
            agent: "code",
            noReply: true,
            parts: [
              { type: "text", text: "profile attached" },
              { type: "file", mime: "text/plain", url: pathToFileURL(file).href, filename: "trace.jfr" },
            ],
          })
          const stored = yield* sessions.messages({ sessionID: session.id })
          return stored
            .flatMap((msg) => msg.parts)
            .filter((part): part is MessageV2.TextPart => part.type === "text" && part.synthetic === true)
            .map((part) => part.text)
        }).pipe(Effect.provide(layer), provideInstance(tmp.path), Effect.provide(testInstanceStoreLayer), Effect.scoped),
      ),
  })

  const failure = texts.find((text) => text.startsWith("Read tool failed to read "))
  expect(failure).toBeDefined()
  expect(failure?.startsWith(`Read tool failed to read ${file} with the following error: `)).toBe(true)
})
