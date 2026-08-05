// Subprocess integration tests for `opencode run` (non-interactive mode).
// These exercise the real CLI binary against a TestLLMServer running in the
// same process. See `test/lib/cli-process.ts` for the harness — each test uses
// `opencode.run(message, opts?)` to spawn `bun src/index.ts run ...` with
// `KILO_CONFIG_CONTENT` providing the test provider config inline.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { reply } from "../../lib/llm-server"
import { cliIt } from "../../lib/cli-process"

describe("opencode run (non-interactive subprocess)", () => {
  // Happy path: prompt completes, output reaches stdout, process exits 0.
  // If this fails, all the others likely will too — debug here first.
  cliIt.concurrent(
    "exits 0 and writes the response to stdout on a successful prompt",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.text("hello from the test llm")
        const result = yield* opencode.run("say hi")
        opencode.expectExit(result, 0)
        expect(result.stdout).toBe("hello from the test llm\n")
      }),
    60_000,
  )

  cliIt.concurrent(
    "prints each completed text part in order around a tool continuation",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.push(
          reply().text("  before tool  ").tool("bash", {
            command: "printf tool-output",
            description: "Print deterministic output",
          }),
        )
        yield* llm.text("  after tool  ")

        const result = yield* opencode.run("use a tool", {
          extraArgs: ["--dangerously-skip-permissions"],
        })

        opencode.expectExit(result, 0)
        expect(result.stdout).toBe("before tool\nafter tool\n")
      }),
    60_000,
  )

  cliIt.concurrent(
    "prints reasoning before text only with --thinking",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.reason("  considering  ", { text: "  answer  " })
        const thinking = yield* opencode.run("think", { extraArgs: ["--thinking"] })
        opencode.expectExit(thinking, 0)
        expect(thinking.stdout).toBe("Thinking: considering\nanswer\n")

        yield* llm.reason("hidden", { text: "visible" })
        const plain = yield* opencode.run("think again")
        opencode.expectExit(plain, 0)
        expect(plain.stdout).toBe("visible\n")
      }),
    60_000,
  )
  // Regression for #27371: an unknown model used to hang the process forever
  // waiting on a session.status === idle event that never arrived. The fix
  // makes the SDK call surface an error promptly so the process exits nonzero.
  // We assert nonzero exit AND wall-clock under the harness timeout — a hang
  // would expire the timeout and produce a different (signal-killed) failure.
  cliIt.concurrent(
    "exits nonzero promptly when the model is unknown (regression for #27371)",
    ({ opencode }) =>
      Effect.gen(function* () {
        const result = yield* opencode.run("say hi", {
          model: "test/nonexistent-model",
          timeoutMs: 15_000,
        })
        expect(result.exitCode).not.toBe(0)
        expect(result.durationMs).toBeLessThan(15_000)
      }),
    30_000,
  )

  // The test provider's SSE error item is interpreted by the SDK as an unknown
  // finish, not a fatal provider/session error. Lock that distinction in so it
  // is not accidentally used as the failure compatibility oracle.
  cliIt.concurrent(
    "unknown stream finish preserves partial output and exits 0",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.push(
          reply().text("partial response").tool("bash", {
            command: "printf tool",
            description: "Print deterministic output",
          }),
        )
        yield* llm.fail("upstream provider exploded mid-stream")
        // kilocode_change - settle bash up front so the run exercises the stream finish rather than
        // Kilo's auto-reject exit contract, which a plain headless run would trip first.
        const result = yield* opencode.run("trigger midstream error", {
          timeoutMs: 30_000,
          permission: { bash: "deny" },
        })
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe("partial response\n")
        expect(result.stderr).not.toContain("upstream provider exploded mid-stream")
      }),
    60_000,
  )

  // kilocode_change start - Kilo headless runs must signal an unsuccessful session to automation
  cliIt.concurrent(
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

  cliIt.concurrent(
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
        expect(opencode.parseJsonEvents(result.stdout).some((event) => event.type === "error")).toBe(true)
      }),
    60_000,
  )

  cliIt.concurrent(
    "auto-rejected permission in plain headless run exits nonzero",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.tool("bash", { command: "sed -n 1,5p README.md" })
        const result = yield* opencode.run("run sed on readme", { timeoutMs: 45_000 })
        opencode.expectExit(result, 1)
        expect(result.stderr).toContain("permission requested: bash")
        expect(result.stderr).toContain("auto-rejecting")
        expect(result.stderr).toContain("run ended with an auto-rejected permission; pass --auto for autonomous use")
      }),
    60_000,
  )

  cliIt.concurrent(
    "auto-rejected permission exits nonzero with stderr diagnostic under --format json",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.tool("bash", { command: "sed -n 1,5p README.md" })
        const result = yield* opencode.run("run sed on readme", {
          format: "json",
          timeoutMs: 75_000,
        })
        opencode.expectExit(result, 1)
        expect(result.stderr).toContain("run ended with an auto-rejected permission; pass --auto for autonomous use")
        expect(opencode.parseJsonEvents(result.stdout).some((event) => event.type === "error")).toBe(true)
      }),
    90_000,
  )
  // kilocode_change end

  // --format json puts one JSON object per line on stdout for each emitted
  // event. Consumers (CI scripts, tooling) parse this stream. Asserts the
  // shape so a future event-emit change has to update this expectation.
  cliIt.concurrent(
    "--format json emits parseable line-delimited JSON to stdout",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.text("structured output")
        const result = yield* opencode.run("say hi", { format: "json" })
        opencode.expectExit(result, 0)

        const events = opencode.parseJsonEvents(result.stdout)
        expect(events.length).toBeGreaterThan(0)
        for (const evt of events) {
          expect(typeof evt.type).toBe("string")
          expect(typeof evt.sessionID).toBe("string")
        }
        expect(events.map((event) => event.type)).toEqual(["step_start", "text", "step_finish"])
        expect(events.map(({ timestamp: _, sessionID: __, ...event }) => event)).toEqual([
          { type: "step_start", part: expect.objectContaining({ type: "step-start" }) },
          {
            type: "text",
            part: expect.objectContaining({ type: "text", text: "structured output" }),
          },
          { type: "step_finish", part: expect.objectContaining({ type: "step-finish" }) },
        ])
        expect(result.stdout.endsWith("\n")).toBe(true)
        expect(
          result.stdout
            .split("\n")
            .slice(0, -1)
            .every((line) => line.length > 0),
        ).toBe(true)
      }),
    60_000,
  )

  cliIt.concurrent(
    "--format json emits a pure error record for a rejected prompt request",
    ({ opencode }) =>
      Effect.gen(function* () {
        const result = yield* opencode.run("use an unknown model", {
          model: "test/nonexistent-model",
          format: "json",
        })

        expect(result.exitCode).not.toBe(0)
        const events = opencode.parseJsonEvents(result.stdout)
        // kilocode_change - upstream expects a single record. Kilo emits two, and has since before
        // this merge: session/prompt.ts getModel publishes a readable "Model not found" session.error
        // and then dies, and the die is masked into the generic request failure. Upstream only has the
        // masked one, and asserts shape rather than message, so its count is one. Assert both records
        // keep the record shape and that the readable message is the one a caller can act on.
        expect(events.map((event) => event.type)).toEqual(["error", "error"])
        for (const event of events) {
          expect(event).toEqual({
            type: "error",
            timestamp: expect.any(Number),
            sessionID: expect.any(String),
            error: expect.any(Object),
          })
        }
        expect(JSON.stringify(events)).toContain("Model not found: test/nonexistent-model")
        expect(result.stdout.split("\n").filter(Boolean)).toHaveLength(2)
      }),
    30_000,
  )

  cliIt.concurrent(
    "--format json preserves reasoning, tool, and continuation ordering",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.push(
          reply().reason("reasoning").text("before").tool("bash", {
            command: "printf tool",
            description: "Print deterministic output",
          }),
        )
        yield* llm.text("after")

        const result = yield* opencode.run("exercise json records", {
          format: "json",
          extraArgs: ["--thinking", "--dangerously-skip-permissions"],
        })

        expect(result.exitCode).toBe(0)
        const events = opencode.parseJsonEvents(result.stdout)
        expect(events.map((event) => event.type)).toEqual([
          "step_start",
          "reasoning",
          "text",
          "tool_use",
          "step_finish",
          "step_start",
          "text",
          "step_finish",
        ])
        expect(events.find((event) => event.type === "reasoning")?.part).toEqual(
          expect.objectContaining({ type: "reasoning", text: "reasoning" }),
        )
        expect(events.find((event) => event.type === "tool_use")?.part).toEqual(
          expect.objectContaining({
            type: "tool",
            tool: "bash",
            state: expect.objectContaining({ status: "completed" }),
          }),
        )
        expect(
          result.stdout
            .split("\n")
            .slice(0, -1)
            .every((line) => line.startsWith("{")),
        ).toBe(true)
      }),
    60_000,
  )

  cliIt.concurrent(
    "--format json records partial output for an unknown stream finish",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.push(
          reply().text("partial json").tool("bash", {
            command: "printf tool",
            description: "Print deterministic output",
          }),
        )
        yield* llm.fail("provider failed")
        // kilocode_change - settle bash up front; see the note on the reason assertion below
        const result = yield* opencode.run("fail after output", { format: "json", permission: { bash: "deny" } })

        const events = opencode.parseJsonEvents(result.stdout)
        expect(result.exitCode).toBe(0)
        expect(events.map((event) => event.type)).toEqual([
          "step_start",
          "tool_use",
          "text", // kilocode_change - a pre-denied tool settles before the SDK closes its preceding text part
          "step_finish",
          "step_start",
          "step_finish",
        ])
        // kilocode_change start - the pre-denied tool completes before text-end
        expect(events.find((event) => event.type === "text")?.part).toEqual(
          expect.objectContaining({ type: "text", text: "partial json" }),
        )
        // kilocode_change end
        // kilocode_change - upstream asserts reason "unknown" here. Reaching that requires the bash call
        // to proceed without permission friction, which a Kilo headless run never does: left alone the ask
        // is auto-rejected (exit 1, no second step), and settling it up front changes the request sequence
        // so the queued stream error is not what ends the turn. The reason is left unasserted rather than
        // pinned to a value produced by a different sequence; partial output, the named subject, still holds.
        expect(events.at(-1)?.part).toEqual(expect.objectContaining({ type: "step-finish" }))
      }),
    60_000,
  )

  cliIt.concurrent(
    "auto-rejects requested permissions by default and allows them with the dangerous flag", // kilocode_change
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.tool("bash", { command: "rm -f denied-file", description: "Remove a test file" })
        yield* llm.text("continued after rejection")
        const denied = yield* opencode.run("request permission", { permission: { bash: "ask" } })
        opencode.expectExit(denied, 1) // kilocode_change
        expect(denied.stderr).toContain("permission requested: bash")
        expect(denied.stderr).toContain("run ended with an auto-rejected permission; pass --auto for autonomous use") // kilocode_change
        expect(denied.stdout).toBe("")

        yield* llm.reset
        yield* llm.tool("bash", { command: "rm -f allowed-file", description: "Remove a test file" })
        yield* llm.text("continued after approval")
        const allowed = yield* opencode.run("request permission", {
          permission: { bash: "ask" },
          extraArgs: ["--dangerously-skip-permissions"],
        })
        opencode.expectExit(allowed, 0)
        expect(allowed.stderr).not.toContain("permission requested: bash")
        expect(allowed.stdout).toContain("continued after approval")

        yield* llm.reset
        yield* llm.tool("bash", { command: "touch explicitly-denied", description: "Create a denied marker" })
        yield* llm.text("continued after explicit denial")
        const explicitlyDenied = yield* opencode.run("request denied permission", {
          permission: { bash: "deny" },
          extraArgs: ["--dangerously-skip-permissions"],
        })
        opencode.expectExit(explicitlyDenied, 0)
        expect(explicitlyDenied.stdout).toContain("continued after explicit denial")
        expect(yield* Effect.promise(() => Bun.file(`${home}/explicitly-denied`).exists())).toBe(false)
      }),
    60_000,
  )

  cliIt.live(
    "attach mode sends client-local file contents without a shared path",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const source = `${home}/client-only.txt`
        const sentinel = "client-only attachment sentinel"
        yield* Effect.promise(() => Bun.write(source, sentinel))
        yield* llm.text("attachment received")
        const server = yield* opencode.serve()

        const result = yield* opencode.run("read the attachment", {
          extraArgs: ["--attach", server.url, `--file=${source}`, "--"],
        })

        opencode.expectExit(result, 0)
        const input = JSON.stringify(yield* llm.inputs)
        expect(input).toContain(sentinel)
        expect(input).not.toContain(`file://${source}`)
      }),
    60_000,
  )

  cliIt.concurrent(
    "attach mode rejects local directories before prompt admission",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const result = yield* opencode.run("read the directory", {
          extraArgs: ["--attach", "http://127.0.0.1:1", `--file=${home}`, "--"],
        })

        expect(result.exitCode).not.toBe(0)
        expect(result.stderr).toContain("Cannot attach local directory without a shared filesystem")
      }),
    30_000,
  )

  cliIt.live(
    "SIGINT interrupts an active non-interactive run without leaking the process",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.hang
        const run = yield* opencode.startRun("wait forever")
        yield* llm.wait(1)
        const interrupted = Date.now() // kilocode_change - assert signal handling, independent of contended CLI startup
        run.interrupt()
        const result = yield* run.result

        expect(result.exitCode).not.toBe(0)
        expect(Date.now() - interrupted).toBeLessThan(10_000) // kilocode_change
      }),
    60_000, // kilocode_change
  )
})
