import { expect, test } from "bun:test"
import { KiloStream } from "../src/stream.js"

test("retains metadata across chunks and stamps final Chat usage with the successful route and request ID", async () => {
  const frames =
    [
      { model: "kilo-auto/free", choices: [{ delta: { content: "fixture" } }] },
      {
        provider_metadata: {
          gateway: {
            marketCost: "0",
            routing: {
              modelAttempts: [
                { success: true, canonicalSlug: "vendor/earlier" },
                { success: false, canonicalSlug: "vendor/failed" },
                { success: true, canonicalSlug: "vendor/actual" },
              ],
            },
          },
        },
      },
      {
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 2, cost_details: { upstream_inference_cost: 0.1 } },
      },
    ]
      .map((frame) => `data: ${JSON.stringify(frame)}\r\n\r\n`)
      .join("") + "data: [DONE]\r\n\r\n"
  const bytes = new TextEncoder().encode(frames)
  const complete: KiloStream.StreamMetadata[] = []
  const response = KiloStream.transformResponse(
    new Response(
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7))
          controller.close()
        },
      }),
      { headers: { "content-type": "text/event-stream", "x-vercel-id": "fixture-request" } },
    ),
    (meta) => complete.push(meta),
  )
  const final = (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data: {"))
    .map((line) => JSON.parse(line.slice(6)))
    .at(-1)
  expect(final.usage).toEqual({
    prompt_tokens: 10,
    completion_tokens: 2,
    cost_details: { upstream_inference_cost: 0.1 },
    routedModelID: "vendor/actual",
    vercelID: "fixture-request",
    gateway: framesGateway(),
  })
  expect(complete).toEqual([{ routedModelID: "vendor/actual", vercelID: "fixture-request", gateway: framesGateway() }])
})

test.each([
  { type: "response.completed", response: { model: "vendor/responses", usage: { input_tokens: 5, output_tokens: 2 } } },
  { type: "message_start", message: { model: "vendor/messages", usage: { input_tokens: 5, output_tokens: 2 } } },
])("stamps nested Responses and Messages usage", (frame) => {
  const output = JSON.parse(
    KiloStream.transformSseData(JSON.stringify(frame), undefined, undefined, {
      gateway: { marketCost: "1.25" },
      vercelID: "native-request",
    }),
  )
  expect((output.response ?? output.message).usage).toMatchObject({
    routedModelID: (frame.response ?? frame.message)?.model,
    gateway: { marketCost: "1.25" },
    vercelID: "native-request",
  })
})

test("normalizes successful JSON usage for native compaction without consuming the body twice", async () => {
  const response = KiloStream.transformResponse(
    Response.json(
      {
        model: "vendor/compact",
        usage: { input_tokens: 9, output_tokens: 1 },
        provider_metadata: { gateway: { marketCost: "0.75" } },
      },
      { headers: { "x-vercel-id": "compaction-request" } },
    ),
  )
  expect(await response.json()).toMatchObject({
    usage: {
      input_tokens: 9,
      output_tokens: 1,
      routedModelID: "vendor/compact",
      gateway: { marketCost: "0.75" },
      vercelID: "compaction-request",
    },
  })
})

function framesGateway() {
  return {
    marketCost: "0",
    routing: {
      modelAttempts: [
        { success: true, canonicalSlug: "vendor/earlier" },
        { success: false, canonicalSlug: "vendor/failed" },
        { success: true, canonicalSlug: "vendor/actual" },
      ],
    },
  }
}
