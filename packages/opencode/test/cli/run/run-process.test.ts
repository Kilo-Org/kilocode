// Subprocess integration tests for `opencode run` (non-interactive mode).
// These exercise the real CLI binary against a TestLLMServer running in the
// same process. See `test/lib/cli-process.ts` for the harness — each test uses
// `opencode.run(message, opts?)` to spawn `bun src/index.ts run ...` with
// `KILO_CONFIG_CONTENT` providing the test provider config inline.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { cliIt } from "../../lib/cli-process"

describe("opencode run (non-interactive subprocess)", () => {
  // kilocode_change start
  // Keep full CLI subprocesses serial within this file; the test runner already
  // executes files in parallel, and nested concurrency exhausts Windows CI.
  // Happy path: prompt completes, output reaches stdout, process exits 0.
  // If this fails, all the others likely will too — debug here first.
  cliIt.live(
    "exits 0 and writes the response to stdout on a successful prompt",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.text("hello from the test llm")
        const result = yield* opencode.run("say hi")
        opencode.expectExit(result, 0)
        expect(result.stdout).toContain("hello from the test llm")
      }),
    60_000,
  )
  // kilocode_change end

  // kilocode_change start
  // Regression for #27371: an unknown model used to hang the process forever
  // waiting on a session.status === idle event that never arrived. The fix
  // makes the SDK call surface an error promptly so the process exits 1.
  // A harness timeout produces synthetic exit code -1, so the exact assertion
  // distinguishes the intended failure from a signal-killed process.
  cliIt.live(
    "exits nonzero promptly when the model is unknown (regression for #27371)",
    ({ opencode }) =>
      Effect.gen(function* () {
        const result = yield* opencode.run("say hi", {
          model: "test/nonexistent-model",
          timeoutMs: 30_000,
        })
        opencode.expectExit(result, 1)
      }),
    60_000,
  )
  // kilocode_change end

  // kilocode_change start
  // Was: "mid-stream LLM error still exits 0 today (contract lock-in)" using
  // llm.fail(...). That fixture never published a session.error the CLI
  // consumed (stream failure recovered as incomplete; idle with error unset),
  // so the lock-in was locking in a false premise. Contract change: a run
  // whose session actually errored mid-stream must exit non-zero with a
  // stderr diagnostic naming the cause — callers (docs-sync) cannot otherwise
  // distinguish success from a dead run and had to stop trusting exit codes.
  cliIt.live(
    "mid-stream session error exits nonzero with a stderr diagnostic",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.error(400, { error: { message: "upstream provider exploded mid-stream" } })
        const result = yield* opencode.run("trigger midstream error", { timeoutMs: 30_000 })
        opencode.expectExit(result, 1)
        expect(result.stderr).toContain("upstream provider exploded mid-stream")
      }),
    60_000,
  )

  cliIt.live(
    "mid-stream session error exits nonzero with stderr diagnostic under --format json",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.error(400, { error: { message: "upstream provider exploded mid-stream" } })
        const result = yield* opencode.run("trigger midstream error", {
          format: "json",
          timeoutMs: 30_000,
        })
        opencode.expectExit(result, 1)
        expect(result.stderr).toContain("upstream provider exploded mid-stream")
        const events = opencode.parseJsonEvents(result.stdout)
        expect(events.some((event) => event.type === "error")).toBe(true)
      }),
    60_000,
  )

  // Plain headless run (no --auto): CLI auto-rejects bash asks under the
  // harness's isolated config. Any auto-reject ⇒ non-zero, even if idle.
  cliIt.live(
    "auto-rejected permission in plain headless run exits nonzero",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.tool("bash", { command: "sed -n 1,5p README.md" })
        const result = yield* opencode.run("run sed on readme", { timeoutMs: 45_000 })
        opencode.expectExit(result, 1)
        expect(result.stderr).toContain("permission requested: bash")
        expect(result.stderr).toContain("auto-rejecting")
        expect(result.stderr).toContain(
          "run ended with an auto-rejected permission; pass --auto for autonomous use",
        )
      }),
    60_000,
  )

  cliIt.live(
    "auto-rejected permission exits nonzero with stderr diagnostic under --format json",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.tool("bash", { command: "sed -n 1,5p README.md" })
        const result = yield* opencode.run("run sed on readme", {
          format: "json",
          timeoutMs: 45_000,
        })
        opencode.expectExit(result, 1)
        expect(result.stderr).toContain(
          "run ended with an auto-rejected permission; pass --auto for autonomous use",
        )
        const events = opencode.parseJsonEvents(result.stdout)
        expect(events.some((event) => event.type === "error")).toBe(true)
      }),
    60_000,
  )
  // kilocode_change end

  // kilocode_change start
  // --format json puts one JSON object per line on stdout for each emitted
  // event. Consumers (CI scripts, tooling) parse this stream. Asserts the
  // shape so a future event-emit change has to update this expectation.
  cliIt.live(
    "--format json emits parseable line-delimited JSON to stdout",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.text("structured output")
        const result = yield* opencode.run("say hi", { format: "json", extraArgs: ["--auto"] })
        opencode.expectExit(result, 0)
        expect(result.stdout).not.toContain("auto-rejected permission")

        const events = opencode.parseJsonEvents(result.stdout)
        expect(events.length).toBeGreaterThan(0)
        for (const evt of events) {
          expect(typeof evt.type).toBe("string")
          expect(typeof evt.sessionID).toBe("string")
        }
        expect(events.filter((event) => event.type === "step_start")).toHaveLength(1)
        expect(events.filter((event) => event.type === "text")).toHaveLength(1)
        expect(events.filter((event) => event.type === "step_finish")).toHaveLength(1)
      }),
    60_000,
  )

  cliIt.live(
    "--format json emits each completed tool once",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.tool("glob", { pattern: "package.json" })
        yield* llm.text("tool complete")
        const result = yield* opencode.run("find package.json", { format: "json", extraArgs: ["--auto"] })
        opencode.expectExit(result, 0)

        const events = opencode.parseJsonEvents(result.stdout)
        expect(events.filter((event) => event.type === "tool_use")).toHaveLength(1)
        expect(events.filter((event) => event.type === "text")).toHaveLength(1)
      }),
    60_000,
  )
  // kilocode_change end
})
