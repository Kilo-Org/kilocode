// End-to-end proof of the experimental self-context tools through the real
// `kilo run` CLI. The server process owns the tool registry, so the
// experimental flags are set on the `serve` subprocess and the `run`
// subprocess attaches to it.
import { describe, expect } from "bun:test"
import { createKiloClient } from "@kilocode/sdk/v2"
import { Effect } from "effect"
import { cliIt } from "../lib/cli-process"
import { awaitWithTimeout } from "../lib/effect"
import { reply } from "../lib/llm-server"

const permission = [{ permission: "*", action: "allow", pattern: "*" }] as const

function toolNames(body: Record<string, unknown> | undefined) {
  const tools = body?.tools
  if (!Array.isArray(tools)) return []
  return tools.flatMap((tool) => {
    if (!tool || typeof tool !== "object" || !("function" in tool) || !tool.function) return []
    if (typeof tool.function !== "object" || !("name" in tool.function)) return []
    return typeof tool.function.name === "string" ? [tool.function.name] : []
  })
}

describe("experimental self-context tools through the CLI", () => {
  cliIt.live(
    "does not offer get_context_info or compact when experimental features are off",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        const server = yield* opencode.serve({
          env: { KILO_EXPERIMENTAL: "false", KILO_EXPERIMENTAL_CONTEXT_TOOLS: "false" },
        })
        const client = createKiloClient({ baseUrl: server.url })
        const session = yield* Effect.promise(() => client.session.create({ permission: [...permission] }))
        const sessionID = session.data?.id
        if (!sessionID) throw new Error("test session was not created")

        yield* llm.text("NO_TOOLS")
        const result = yield* opencode.run("list your context tools", {
          extraArgs: ["--attach", server.url, "--session", sessionID, "--auto"],
          timeoutMs: 90_000,
        })
        opencode.expectExit(result, 0)

        const body = (yield* llm.inputs).find(
          (input) =>
            JSON.stringify(input.messages ?? "").includes("list your context tools") && toolNames(input).length > 0,
        )
        if (!body) throw new Error("the prompt never reached the model")

        const names = toolNames(body)
        // Sanity: the request really carried a tool list, so the absence below is meaningful.
        expect(names.length).toBeGreaterThan(0)
        expect(names).not.toContain("get_context_info")
        expect(names).not.toContain("compact")
      }),
    120_000,
  )

  cliIt.live(
    "reports context information and compacts the context when experimental features are on",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        const server = yield* opencode.serve({ env: { KILO_EXPERIMENTAL: "1" } })
        const client = createKiloClient({ baseUrl: server.url })
        const session = yield* Effect.promise(() => client.session.create({ permission: [...permission] }))
        const sessionID = session.data?.id
        if (!sessionID) throw new Error("test session was not created")

        yield* llm.push(
          // step 1: no completed step yet, but it records tokens on the finished step
          reply().tool("get_context_info", {}).usage({ input: 1234, output: 56 }).item(),
          // step 2: a completed step exists, so this reports its recorded tokens
          reply().tool("get_context_info", {}).item(),
          reply().tool("compact", {}).item(),
          // the summariser request the manual compaction triggers
          reply().text("COMPACT_SUMMARY_SENTINEL").stop().item(),
        )

        const result = yield* awaitWithTimeout(
          opencode.run("Call get_context_info twice, then call compact, then stop.", {
            extraArgs: ["--attach", server.url, "--session", sessionID, "--auto"],
            timeoutMs: 90_000,
          }),
          "cli run did not finish",
          "90 seconds",
        )
        opencode.expectExit(result, 0)

        // The experimental gate really opened: both ids were offered to the model.
        const prompt = (yield* llm.inputs).find(
          (input) =>
            JSON.stringify(input.messages ?? "").includes("Call get_context_info twice") && toolNames(input).length > 0,
        )
        if (!prompt) throw new Error("the prompt never reached the model")
        expect(toolNames(prompt)).toContain("get_context_info")
        expect(toolNames(prompt)).toContain("compact")

        const messages = yield* Effect.promise(() => client.session.messages({ sessionID }))
        const parts = (messages.data ?? []).flatMap((message) => message.parts)
        const tools = parts.filter((part) => part.type === "tool")

        const infos = tools.filter((part) => part.tool === "get_context_info")
        const compacts = tools.filter((part) => part.tool === "compact")
        expect(infos).toHaveLength(2)
        expect(compacts).toHaveLength(1)
        for (const part of [...infos, ...compacts]) expect(part.state.status).toBe("completed")

        const first = infos.at(0)
        const second = infos.at(1)
        if (!first || !second) throw new Error("expected two completed get_context_info calls")
        if (first.state.status !== "completed") throw new Error("first get_context_info did not complete")
        if (second.state.status !== "completed") throw new Error("second get_context_info did not complete")

        const empty = JSON.parse(first.state.output)
        expect(empty.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
        expect(empty.tokens).toBeNull()
        expect(empty.contextTokens).toBe(0)
        expect(empty.contextLimit).toBe(100_000)

        // The second call reports the tokens recorded on the previous finished step.
        const holder = (messages.data ?? []).find(
          (message) => message.info.role === "assistant" && message.parts.some((part) => part.id === first.id),
        )
        if (!holder || holder.info.role !== "assistant") throw new Error("no assistant step holds the first call")
        const tokens = holder.info.tokens
        const recorded = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
        expect(recorded).toBeGreaterThan(0)

        const filled = JSON.parse(second.state.output)
        expect(filled.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
        expect(filled.contextTokens).toBe(recorded)
        expect(filled.contextLimit).toBe(100_000)

        // The compaction really happened: a compaction part and a summary message carrying the text.
        expect(parts.some((part) => part.type === "compaction")).toBe(true)
        const summary = (messages.data ?? []).find(
          (message) => message.info.role === "assistant" && message.info.summary === true,
        )
        if (!summary) throw new Error("no summary message was persisted")
        const summaryText = summary.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
        expect(summaryText).toContain("COMPACT_SUMMARY_SENTINEL")

        // The summariser LLM call really ran after the compact tool call.
        expect(JSON.stringify(yield* llm.inputs)).toContain("Output exactly the Markdown structure")
      }),
    120_000,
  )
})
