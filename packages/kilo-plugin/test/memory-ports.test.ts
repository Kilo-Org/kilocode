import { expect, test } from "bun:test"
import type { Session } from "@opencode/core/session"
import { Agent } from "@opencode/schema/agent"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { SessionID } from "@opencode/schema/session-id"
import { SessionMessage } from "@opencode/schema/session-message"
import { Tool } from "@opencode/schema/tool"
import { DateTime, Effect } from "effect"
import { MemoryPortsV2 } from "../src/memory/ports"

const created = DateTime.makeUnsafe(1_700_000_000_000)
const model = { id: Model.ID.make("flash"), providerID: Provider.ID.make("kilo") }

const user = (text: string): SessionMessage.Info => ({
  id: SessionMessage.ID.create(),
  time: { created },
  type: "user",
  text,
})

const assistant = (
  content: Extract<SessionMessage.Info, { type: "assistant" }>["content"],
  done = true,
): SessionMessage.Info => ({
  id: SessionMessage.ID.create(),
  time: done ? { created, completed: created } : { created },
  type: "assistant",
  agent: Agent.ID.make("code"),
  model,
  content,
})

const tool = (name: string, input: Record<string, unknown>, metadata: Record<string, number | string> = {}) => ({
  type: "tool" as const,
  id: Tool.CallID.make(`call-${name}`),
  name,
  time: { created },
  state: {
    status: "completed" as const,
    input,
    content: [{ type: "text" as const, text: "ok" }] as [{ type: "text"; text: string }],
    metadata,
  },
})

// The session port reads only messages, diff and get; the rest of the service is not reached.
const sessions = (messages: SessionMessage.Info[], parentID?: string) =>
  ({
    messages: (input: {
      order?: "asc" | "desc"
      type?: string
      limit?: number
      cursor?: { id: string; direction: "previous" | "next" }
    }) => {
      const start = input.cursor ? messages.findIndex((item) => item.id === input.cursor!.id) + 1 : 0
      const rows = messages.slice(start).filter((item) => !input.type || item.type === input.type)
      const ordered = input.order === "asc" ? rows : rows.toReversed()
      return Effect.succeed(input.limit === undefined ? ordered : ordered.slice(0, input.limit))
    },
    diff: () =>
      Effect.succeed([{ file: "src/a.ts", patch: "", additions: 30, deletions: 2, status: "modified" as const }]),
    get: () => Effect.succeed({ parentID }),
  }) as unknown as Session.Interface

test("the session port reads the latest turn with every assistant step, the diffs and recall usage", async () => {
  const messages = [
    user("old question"),
    assistant([{ type: "text", text: "old answer" }]),
    user("How do we deploy?"),
    assistant([tool("kilo_memory_recall", { mode: "search", query: "deploy" }, { count: 2 })]),
    assistant([
      tool("shell", { command: "fly deploy --remote-only" }, { exit: 0 }),
      { type: "text", text: "Use fly deploy." },
    ]),
  ]
  const view = await Effect.runPromise(
    MemoryPortsV2.session(sessions(messages)).readTurn({ sessionID: SessionID.make("ses_a"), window: 24 }),
  )
  expect(view?.user).toBe("How do we deploy?")
  expect(view?.assistant).toContain("Tool kilo_memory_recall completed | query=deploy")
  expect(view?.assistant).toContain("command=fly deploy --remote-only | exit=0")
  expect(view?.assistant).toContain("Use fly deploy.")
  expect(view?.assistant).not.toContain("old answer")
  expect(view?.recent).toContain("User: old question")
  expect(view?.lastAssistantID).toBe(messages[4]!.id)
  expect(view?.sessionModel).toEqual({ providerID: "kilo", modelID: "flash" })
  expect(view?.recalledMemory).toBe(true)
  expect(view?.diffs).toEqual([{ file: "src/a.ts", status: "modified", additions: 30, deletions: 2 }])
})

test("the session port reads a turn longer than the recent-context window", async () => {
  const steps = Array.from({ length: 40 }, (_, index) => assistant([{ type: "text", text: `step ${index}` }]))
  const view = await Effect.runPromise(
    MemoryPortsV2.session(sessions([user("Refactor the parser"), ...steps])).readTurn({
      sessionID: SessionID.make("ses_a"),
      window: 24,
    }),
  )
  expect(view?.user).toBe("Refactor the parser")
  expect(view?.assistant).toContain("step 0")
  expect(view?.assistant).toContain("step 39")
  expect(view?.lastAssistantID).toBe(steps[39]!.id)
})

test("the session port has no turn while the last step is still running, and reports the parent", async () => {
  const port = MemoryPortsV2.session(
    sessions([user("go"), assistant([{ type: "text", text: "…" }], false)], "ses_parent"),
  )
  expect(await Effect.runPromise(port.readTurn({ sessionID: SessionID.make("ses_a"), window: 24 }))).toBeUndefined()
  expect(await Effect.runPromise(port.get({ sessionID: "ses_a" }))).toEqual({ parentID: "ses_parent" })
})

const runtime = (available: boolean, reply: Effect.Effect<string> = Effect.succeed("{}")) => {
  const calls: { prompt: string; model: Model.Ref }[] = []
  const warnings: string[] = []
  const port = MemoryPortsV2.model({
    exists: () => Effect.succeed(available),
    text: (input) => Effect.sync(() => calls.push(input)).pipe(Effect.andThen(reply)),
    warn: (message) => warnings.push(message),
  })
  return { port, calls, warnings }
}
const session = { providerID: "kilo", modelID: "flash" }

test("the model port uses the configured memory model and falls back to the session model", async () => {
  const configured = await Effect.runPromise(runtime(true).port.resolve({ configured: "openai/gpt-mini", session }))
  expect(configured).toEqual({ handle: { providerID: "openai", id: "gpt-mini" } })

  const unset = await Effect.runPromise(runtime(true).port.resolve({ session }))
  expect(unset).toEqual({ handle: { providerID: "kilo", id: "flash" } })

  const malformed = runtime(true)
  expect(await Effect.runPromise(malformed.port.resolve({ configured: "no-slash", session }))).toEqual({
    handle: { providerID: "kilo", id: "flash" },
    fallback: { reason: "invalid model" },
  })
  expect(malformed.warnings).toEqual(["memory model config ignored"])

  expect(await Effect.runPromise(runtime(false).port.resolve({ configured: "openai/gone", session }))).toEqual({
    handle: { providerID: "kilo", id: "flash" },
    fallback: { reason: "model unavailable" },
  })
})

test("the model port sends the system prompt ahead of the evidence and times out", async () => {
  const ok = runtime(true, Effect.succeed('{"topic":"t"}'))
  const result = await ok.port.run({
    handle: model,
    sessionID: "ses_a",
    system: "SYSTEM",
    prompt: "EVIDENCE",
    timeoutMs: 1_000,
  })
  expect(result.text).toBe('{"topic":"t"}')
  expect(ok.calls).toEqual([{ prompt: "SYSTEM\n\nEVIDENCE", model }])

  const slow = runtime(true, Effect.never)
  const error = await slow.port
    .run({ handle: model, sessionID: "ses_a", system: "S", prompt: "P", timeoutMs: 20 })
    .then(
      () => undefined,
      (cause) => cause,
    )
  expect(String(error)).toContain("memory model timed out")
})
