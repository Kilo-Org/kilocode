// kilocode_change - new file
// Subprocess regression tests for the piped-stdin read of `kilo run`.
//
// Root cause: loadInput() awaited `Bun.stdin.text()` unbounded. With a
// launcher-held-open stdin pipe (the workflow driver's spawn) the stream
// never EOFs, so the run hung forever before the prompt. The fix bounds the
// wait when argv already carries a message or command (src/cli/cmd/
// run-stdin.ts); stdin as the sole input still waits for EOF.
//
// Harness support: startRun(message, { stdin: "pipe" }) spawns the child with
// a writable stdin; run.stdin.write/end drive it. See test/lib/cli-process.ts.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { cliIt } from "../../lib/cli-process"

describe("kilo run piped stdin (subprocess)", () => {
  // THE regression: argv message + stdin pipe held open (never write, never
  // end). Before the fix the child blocked in `Bun.stdin.text()` and this
  // test died on the 60s bun timeout. After the fix the bounded read fires,
  // the run proceeds, and the first step_start lands within 20s of spawn.
  cliIt.concurrent(
    "completes with an argv message while piped stdin stays open (regression)",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.text("hello from the test llm")
        const spawnedAt = Date.now()
        const run = yield* opencode.startRun("say hi", { stdin: "pipe", format: "json" })
        const result = yield* run.result
        opencode.expectExit(result, 0)
        expect(result.stdout).toContain("hello from the test llm")

        const events = opencode.parseJsonEvents(result.stdout)
        const stepStart = events.find((event) => event.type === "step_start")
        expect(stepStart).toBeDefined()
        expect(typeof stepStart!.timestamp).toBe("number")
        expect(Number(stepStart!.timestamp) - spawnedAt).toBeLessThanOrEqual(20_000)
      }),
    60_000,
  )

  // Sole-input stdin keeps the upstream wait-for-EOF semantics: no argv
  // message, so the read is unbound and the prompt arrives after stdin end().
  cliIt.concurrent(
    "uses the piped prompt as the run input when argv has no message",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.text("piped prompt received")
        const run = yield* opencode.startRun(undefined, { stdin: "pipe" })
        yield* Effect.promise(() => run.stdin.write("summarize the piped notes\n"))
        run.stdin.end()
        const result = yield* run.result
        opencode.expectExit(result, 0)
        expect(result.stdout).toContain("piped prompt received")
        const input = JSON.stringify(yield* llm.inputs)
        expect(input).toContain("summarize the piped notes")
      }),
    60_000,
  )

  // Append guard: the bound path must still append piped text that lands
  // before the silence timer, so `kilo run main < extra` keeps both parts.
  cliIt.concurrent(
    "appends piped text to the argv message when stdin ends before the bound fires",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.text("append preserved")
        const run = yield* opencode.startRun("main", { stdin: "pipe" })
        yield* Effect.promise(() => run.stdin.write("extra"))
        run.stdin.end()
        const result = yield* run.result
        opencode.expectExit(result, 0)
        expect(result.stdout).toContain("append preserved")
        const input = JSON.stringify(yield* llm.inputs)
        expect(input).toContain("main")
        expect(input).toContain("extra")
        // The joined form ("main\nextra" in the JSON string) proves the append
        // landed in resolveRunInput order, not a coincidental substring match.
        expect(input).toContain("main\\nextra")
      }),
    60_000,
  )

  // Empty stdin EOF with no argv message: the unbound read resolves to "",
  // so the existing usage error still fires with exit 1.
  cliIt.concurrent(
    "exits 1 with the usage error on empty stdin EOF and no argv message",
    ({ opencode }) =>
      Effect.gen(function* () {
        const run = yield* opencode.startRun(undefined, { stdin: "pipe" })
        run.stdin.end()
        const result = yield* run.result
        opencode.expectExit(result, 1)
        expect(result.stderr).toContain("You must provide a message or a command")
      }),
    60_000,
  )
})
