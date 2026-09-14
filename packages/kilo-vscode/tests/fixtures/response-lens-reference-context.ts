import assert from "node:assert/strict"
import { createHook } from "node:async_hooks"
import { createKiloClient } from "@kilocode/sdk/v2"
import { createResponseLensHandler, responseLensDirectory } from "../../src/kilo-provider/response-lens"
import { resolveReferences } from "../../src/kilo-provider/response-lens-references"
import type { ExplainBrieflyError, ExplainBrieflyRequest, ExplainBrieflyResult } from "../../src/shared/response-lens"

export type Input = {
  directory: string
  references?: ExplainBrieflyRequest["references"]
  context?: ExplainBrieflyRequest["context"]
  text?: string
  approval?: "allow" | "deny" | "pending"
  action?: "resolve" | "cancel" | "capture"
  route?: string | null
}
export type Output = {
  calls: {
    url: string
    method: string
    body: Omit<ExplainBrieflyRequest, "type" | "requestId" | "sessionID" | "messageID">
  }[]
  replies: (ExplainBrieflyError | ExplainBrieflyResult)[]
  approvals: { file: string; operations: number }[]
  io: { operation: string; stack: string }[]
  ids: string[]
  checkpoint?: number
  resolved?: Awaited<ReturnType<typeof resolveReferences>>
  error?: string
  unchanged: boolean
}

async function main() {
  assert.equal(process.release.name, "node", "Reference retrieval must run in actual Node, not Bun")
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  const input: Input = JSON.parse(Buffer.concat(chunks).toString())
  const output: Output = { calls: [], replies: [], approvals: [], io: [], ids: [], unchanged: true }
  const message: ExplainBrieflyRequest = {
    type: "explainBriefly",
    requestId: "reference-request",
    sessionID: "captured-session",
    messageID: "captured-answer",
    model: { providerID: "fixture-provider", modelID: "captured-model" },
    level: "high-school",
    text: input.text ?? "Explain the selected reference.",
    context: input.context ?? [{ role: "assistant", text: "Captured conversation context." }],
    references: input.references ?? [],
  }
  const original = JSON.stringify(message)
  const entered = Promise.withResolvers<void>()
  const consent = Promise.withResolvers<boolean>()
  const confirm = async (file: string) => {
    output.approvals.push({ file, operations: output.io.length })
    entered.resolve()
    return input.approval === "pending" ? consent.promise : input.approval === "allow"
  }
  // Only the final SDK transport reply is synthetic. Resolution, IO and the parser child are real.
  const client = (baseUrl: string) =>
    createKiloClient({
      baseUrl,
      fetch: (async (request: RequestInfo | URL) => {
        const sent = request as Request
        assert.equal(new URL(sent.url).pathname, "/response-lens/explain")
        output.calls.push({ url: sent.url, method: sent.method, body: await sent.json() })
        return Response.json({ text: "Fixture explanation.", truncated: false, model: message.model, usage: {} })
      }) as typeof fetch,
    })
  const state = {
    session: { id: message.sessionID, directory: input.directory },
    client: client("https://captured-backend.invalid"),
    model: message.model,
    level: message.level,
  }
  const handler = createResponseLensHandler({
    client: () => state.client,
    directory: (id) => {
      output.ids.push(id)
      return responseLensDirectory(id, input.route, undefined, state.session)
    },
    enabled: () => true,
    confirmFile: input.approval ? confirm : undefined,
    post: (reply) => output.replies.push(reply),
  })
  // Observe real async filesystem requests without mocking fs or altering its return values.
  const hook = createHook({
    init(_id, type) {
      if (!type.startsWith("FSREQ")) return
      const stack = new Error().stack ?? type
      const frame = stack.split("\n").find((line) => /internal[\\/]fs[\\/]promises/.test(line))
      const operation = frame?.match(/at (?:\S+\.)?([^\s.]+) \(/)?.[1] ?? type
      output.io.push({ operation, stack })
    },
  }).enable()
  try {
    if (input.action === "resolve") {
      output.resolved = await resolveReferences({
        directory: input.directory,
        references: message.references!,
        text: message.text,
        context: message.context,
        signal: new AbortController().signal,
        confirmFile: input.approval ? confirm : undefined,
      }).catch((error: unknown) => {
        output.error = error instanceof Error ? error.message : String(error)
        return undefined
      })
    } else {
      const pending = handler.explain(message)
      if (input.action === "cancel" || input.action === "capture") {
        await Promise.race([
          entered.promise,
          pending.then(() => {
            throw new Error("Request completed before reaching external-file approval")
          }),
        ])
        assert.equal(output.calls.length, 0, "Inference started while file approval was pending")
        output.checkpoint = output.io.length
        if (input.action === "cancel") handler.handle({ type: "cancelExplainBriefly", requestId: message.requestId })
        state.session = { id: "later-session", directory: input.directory + "-later-pane" }
        state.client = client("https://later-backend.invalid")
        state.model = { providerID: "later-provider", modelID: "later-model" }
        state.level = "university"
        consent.resolve(true)
      }
      await pending
    }
  } finally {
    hook.disable()
    handler.cancel()
  }
  output.unchanged = original === JSON.stringify(message)
  process.stdout.write(JSON.stringify(output))
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
