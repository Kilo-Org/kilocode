// kilocode_change - new file
// Subprocess tests for `kilo run` when the model produces no assistant message.
// Same harness as run-process.test.ts — see `test/lib/cli-process.ts`.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { reply } from "../../lib/llm-server"
import { cliIt } from "../../lib/cli-process"

// kilocode_change start - a run where the model returns no assistant message used to
// exit 0, so a caller could not tell an empty run from a successful one
describe("opencode run with an empty model completion (non-interactive subprocess)", () => {
  cliIt.concurrent(
    "exits nonzero with a stderr diagnostic",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.push(reply().stop())
        const result = yield* opencode.run("say hi", { timeoutMs: 30_000 })
        opencode.expectExit(result, 1)
        expect(result.stderr).toContain("run ended without an assistant message")
        expect(result.stdout).toBe("")
      }),
    60_000,
  )

  cliIt.concurrent(
    "emits an error record under --format json",
    ({ llm, opencode }) =>
      Effect.gen(function* () {
        yield* llm.push(reply().stop())
        const result = yield* opencode.run("say hi", { format: "json", timeoutMs: 30_000 })
        opencode.expectExit(result, 1)
        expect(result.stderr).toContain("run ended without an assistant message")
        const events = opencode.parseJsonEvents(result.stdout)
        expect(events.at(-1)).toEqual({
          type: "error",
          timestamp: expect.any(Number),
          sessionID: expect.any(String),
          error: "run ended without an assistant message; the model returned no output",
        })
      }),
    60_000,
  )

  // The prompt request itself can fail before the model ever runs (here: an
  // attached image whose base64 exceeds the server's limit → 400 BadRequest,
  // with no session.error event). The real error is reported once; the
  // empty-output diagnostic must not claim a silent model on top of it.
  cliIt.live(
    "request failure reports the real error without the empty-output diagnostic",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        // 4 MiB binary content with a .png extension: under the CLI's 10 MiB
        // attach cap, but its ~5.33 MiB base64 exceeds the server's 5 MiB
        // image limit, so the prompt request fails with a 400 BadRequest.
        const big = Buffer.alloc(4 * 1024 * 1024, 7)
        Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(big, 0)
        yield* Effect.promise(() => Bun.write(`${home}/big.png`, big))
        const server = yield* opencode.serve()

        const result = yield* opencode.run("read the attachment", {
          extraArgs: ["--attach", server.url, `--file=${home}/big.png`, "--"],
          timeoutMs: 30_000,
        })

        opencode.expectExit(result, 1)
        expect(result.stderr).toContain("BadRequest")
        expect(result.stderr).not.toContain("run ended without an assistant message")
      }),
    60_000,
  )

  cliIt.live(
    "request failure emits only the real error record under --format json",
    ({ home, opencode }) =>
      Effect.gen(function* () {
        const big = Buffer.alloc(4 * 1024 * 1024, 7)
        Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(big, 0)
        yield* Effect.promise(() => Bun.write(`${home}/big.json.png`, big))
        const server = yield* opencode.serve()

        const result = yield* opencode.run("read the attachment", {
          format: "json",
          extraArgs: ["--attach", server.url, `--file=${home}/big.json.png`, "--"],
          timeoutMs: 30_000,
        })

        opencode.expectExit(result, 1)
        expect(result.stderr).not.toContain("run ended without an assistant message")
        const events = opencode.parseJsonEvents(result.stdout)
        expect(events).toHaveLength(1)
        expect(events[0]).toEqual({
          type: "error",
          timestamp: expect.any(Number),
          sessionID: expect.any(String),
          error: expect.objectContaining({ _tag: "BadRequest" }),
        })
      }),
    60_000,
  )
})
// kilocode_change end
