import { describe, expect, it } from "bun:test"
import { createKiloClient } from "@kilocode/sdk/v2"
import { createResponseLensHandler, responseLensDirectory } from "../../src/kilo-provider/response-lens"
import type { ExplainBrieflyRequest, ExplainBrieflyResult, ExplainBrieflyError } from "../../src/shared/response-lens"

const model = { providerID: "test", modelID: "active" }
const request: ExplainBrieflyRequest = {
  type: "explainBriefly",
  requestId: "one",
  sessionID: "original",
  messageID: "answer",
  text: "Explain @private.txt",
  level: "simple",
  model,
  context: [{ role: "user", text: "Literal @terminal" }],
}
const result = {
  text: "A short explanation.",
  truncated: false,
  model,
  usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
}
type Reply = ExplainBrieflyResult | ExplainBrieflyError

describe("Response Lens host and generated SDK", () => {
  it("routes existing sidebar history and exact worktrees without a later pane fallback", () => {
    const original = { id: "history", directory: "C:/history" }
    expect(responseLensDirectory("history", undefined, undefined, original)).toBe("C:/history")
    expect(responseLensDirectory("history", undefined, "C:/history", { id: "other", directory: "C:/later" })).toBe(
      "C:/history",
    )
    expect(responseLensDirectory("history", "C:/worktree", "C:/history", original)).toBe("C:/worktree")
    expect(() => responseLensDirectory("history", null, "C:/history", original)).toThrow("ambiguous")
    expect(() =>
      responseLensDirectory("history", undefined, undefined, { id: "other", directory: "C:/later" }),
    ).toThrow("unavailable")
  })
  it("calls only the dedicated authenticated endpoint with the captured directory and explicit model", async () => {
    const seen: Request[] = []
    const body: unknown[] = []
    const client = createKiloClient({
      baseUrl: "http://localhost:9123",
      headers: { Authorization: "Basic test-only" },
      fetch: async (input) => {
        const sent = input as Request
        seen.push(sent)
        body.push(await sent.json())
        return Response.json(result)
      },
    })
    const replies: Reply[] = []
    const ids: string[] = []
    const handler = createResponseLensHandler({
      client: () => client,
      directory: (id) => {
        ids.push(id)
        return "C:/original"
      },
      enabled: () => true,
      post: (reply) => replies.push(reply),
    })
    await handler.explain(request)
    expect(ids).toEqual(["original"])
    expect(seen).toHaveLength(1)
    expect(seen[0]!.method).toBe("POST")
    expect(new URL(seen[0]!.url).pathname).toBe("/response-lens/explain")
    expect(new URL(seen[0]!.url).searchParams.get("directory")).toBe("C:/original")
    expect(seen[0]!.headers.get("Authorization")).toBe("Basic test-only")
    expect(body).toEqual([{ text: request.text, level: request.level, model, context: request.context }])
    expect(replies).toEqual([{ type: "explainBrieflyResult", requestId: "one", ...result }])
    expect(JSON.stringify(replies)).not.toContain("test-only")
  })

  it("cancels only matching requests, supersedes older work and ignores stale responses", async () => {
    const calls: Array<{
      signal: AbortSignal
      url: string
      pending: ReturnType<typeof Promise.withResolvers<Response>>
    }> = []
    const client = createKiloClient({
      baseUrl: "http://localhost:9123",
      fetch: (input) => {
        const sent = input as Request
        const pending = Promise.withResolvers<Response>()
        calls.push({ signal: sent.signal, url: sent.url, pending })
        return pending.promise
      },
    })
    const replies: Reply[] = []
    let directory = "C:/original"
    const handler = createResponseLensHandler({
      client: () => client,
      directory: () => directory,
      enabled: () => true,
      post: (reply) => replies.push(reply),
    })
    const first = handler.explain(request)
    await Bun.sleep(0)
    directory = "C:/later-pane"
    handler.cancel("not-active")
    expect(calls[0]!.signal.aborted).toBe(false)
    const second = handler.explain({ ...request, requestId: "two" })
    await Bun.sleep(0)
    expect(calls[0]!.signal.aborted).toBe(true)
    expect(new URL(calls[0]!.url).searchParams.get("directory")).toBe("C:/original")
    calls[0]!.pending.resolve(Response.json(result))
    await first
    expect(replies).toEqual([])
    calls[1]!.pending.resolve(Response.json(result))
    await second
    expect(replies.map((reply) => reply.requestId)).toEqual(["two"])
    const third = handler.explain({ ...request, requestId: "three" })
    await Bun.sleep(0)
    handler.cancel()
    expect(calls[2]!.signal.aborted).toBe(true)
    calls[2]!.pending.resolve(Response.json(result))
    await third
    expect(replies).toHaveLength(1)
  })

  it.each([404, 405, 422, 500])("returns actionable HTTP %s errors once, never fallback or retry", async (status) => {
    let calls = 0
    const client = createKiloClient({
      baseUrl: "http://localhost:9123",
      fetch: async () => {
        calls++
        return Response.json({ message: "Choose a connected model." }, { status })
      },
    })
    const replies: Reply[] = []
    const handler = createResponseLensHandler({
      client: () => client,
      directory: () => "C:/original",
      enabled: () => true,
      post: (reply) => replies.push(reply),
    })
    await handler.explain(request)
    expect(calls).toBe(1)
    expect(replies[0]?.type).toBe("explainBrieflyError")
    expect((replies[0] as ExplainBrieflyError).error).toContain(
      status === 422
        ? "Choose a connected model"
        : status < 422
          ? "Update the Kilo extension"
          : "Check the selected model",
    )
  })

  it("rejects disabled, invalid, disconnected and unroutable requests before any API call", async () => {
    for (const kind of ["disabled", "invalid", "disconnected", "directory"] as const) {
      const replies: Reply[] = []
      const handler = createResponseLensHandler({
        client: () => null,
        enabled: () => kind !== "disabled",
        directory: () => {
          if (kind === "directory") throw new Error("Original session directory unavailable")
          return "C:/original"
        },
        post: (reply) => replies.push(reply),
      })
      await handler.explain(kind === "invalid" ? { ...request, text: "x".repeat(4001) } : request)
      expect(replies).toHaveLength(1)
      expect(replies[0]?.type).toBe("explainBrieflyError")
    }
  })
})
