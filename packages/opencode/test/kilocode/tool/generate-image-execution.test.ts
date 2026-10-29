import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Agent } from "@/agent/agent"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { Image } from "@/image/image"
import { GenerateImageTool } from "@/kilocode/tool/generate-image"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Truncate } from "@/tool/truncate"
import { TestInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAGAAAABACAYAAADlNHIOAAAAj0lEQVR4nO3RMREAIBDAsJeFDPxPOAEZDM3QvXeZs/bVv+b3QD0AANoBANAOAIB2AAC0AwCgHQAA7QAAaAcAQDsAANoBANAOAIB2AAC0AwCgHQAA7QAAaAcAQDsAANoBANAOAIB2AAC0AwCgHQAA7QAAaAcAQDsAANoBANAOAIB2AAC0AwCgHQAA7QAAaPcAgg6rWP9fiGMAAAAASUVORK5CYII="
const url = `data:image/png;base64,${png}`
const it = testEffect(
  Layer.mergeAll(
    AppNodeBuilder.build(FSUtil.node),
    AppNodeBuilder.build(Agent.node),
    AppNodeBuilder.build(Truncate.node),
    AppNodeBuilder.build(Config.node),
    AppNodeBuilder.build(Image.node),
    Layer.mock(Auth.Service, { get: () => Effect.succeed({ type: "api", key: "test" }) }),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json({ choices: [{ message: { images: [{ image_url: { url } }] } }] }),
          ),
        ),
      ),
    ),
  ),
)

it.instance("saves the original image and returns an attachment accepted by image normalization", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const tool = yield* (yield* GenerateImageTool).init()
    const sessionID = SessionID.make("ses_image")
    const messageID = MessageID.make("msg_image")
    const result = yield* tool.execute(
      { prompt: "A red pixel", path: "assets/pixel" },
      {
        sessionID,
        messageID,
        agent: "code",
        messages: [],
        abort: new AbortController().signal,
        metadata: () => Effect.void,
        ask: (request) => Effect.sync(() => expect(request.permission).toBe("write")),
      },
    )
    expect(yield* Effect.promise(() => Bun.file(`${instance.directory}/assets/pixel.png`).bytes())).toEqual(
      Buffer.from(png, "base64"),
    )
    const attachment = result.attachments?.at(0)
    expect(attachment?.url).toBe(url)
    if (!attachment) throw new Error("Missing generated image attachment")
    const image = yield* Image.Service
    expect((yield* image.normalize({ ...attachment, sessionID, messageID, id: PartID.ascending() })).url).toStartWith(
      "data:image/png;base64,",
    )
  }),
)
