import { expect } from "bun:test"
import { Effect } from "effect"
import { cliIt } from "../../../lib/cli-process"

const diagnostic = "Goal start and resume require the TUI. Run kilo, then use /goal <text> or /goal resume."

function listen(calls: string[]) {
  const session = { id: "ses_goal", directory: "/goal owner", title: "Goal" }
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      calls.push(`${request.method} ${url.pathname}`)
      if (url.pathname === "/session") return Response.json(request.method === "GET" ? [session] : session)
      if (url.pathname === "/config") return Response.json({ share: "auto" })
      if (url.pathname.endsWith("/command")) {
        const body = await request.json()
        expect(body.command).toBe("goal")
        return Response.json({ parts: [{ type: "text", text: `Goal control: ${body.arguments || "status"}` }] })
      }
      return Response.json(session)
    },
  })
}

for (const scenario of [
  { name: "session creation", args: [] },
  { name: "selected session fork", args: ["--session", "ses_goal", "--fork"] },
  { name: "continued session fork", args: ["--continue", "--fork"] },
  { name: "cloud session import", args: ["--session", "ses_cloud", "--cloud-fork"] },
]) {
  cliIt.concurrent(
    `headless goal start and resume reject before ${scenario.name} or any request`,
    ({ opencode }) =>
      Effect.gen(function* () {
        const calls: string[] = []
        using server = listen(calls)
        for (const action of ["Fix failing tests", "resume"]) {
          const result = yield* opencode.spawn([
            "run",
            "--attach",
            server.url.toString(),
            "--command",
            "goal",
            "--share",
            ...scenario.args,
            action,
          ])
          opencode.expectExit(result, 1)
          expect(result.stderr).toContain(diagnostic)
          expect(calls).toEqual([])
        }
      }),
    60_000,
  )
}

for (const text of ["Fix failing tests\n", " resume\n"]) {
  cliIt.concurrent(
    `piped goal ${JSON.stringify(text)} rejects before deferred session lookup`,
    ({ opencode }) =>
      Effect.gen(function* () {
        const calls: string[] = []
        using server = listen(calls)
        const child = yield* opencode.startRun(undefined, {
          command: "goal",
          stdin: "pipe",
          extraArgs: ["--session", "ses_goal", "--fork", "--share", "--attach", server.url.toString()],
        })
        yield* Effect.promise(() => child.stdin.write(text))
        child.stdin.end()
        const result = yield* child.result
        opencode.expectExit(result, 1)
        expect(result.stderr).toContain(diagnostic)
        expect(calls).toEqual([])
      }),
    60_000,
  )
}

cliIt.concurrent(
  "headless goal status, pause, and clear still dispatch without sharing or draining",
  ({ opencode }) =>
    Effect.gen(function* () {
      const calls: string[] = []
      using server = listen(calls)
      for (const action of ["", "pause", "clear"]) {
        const result = yield* opencode.spawn([
          "run",
          "--attach",
          server.url.toString(),
          "--session",
          "ses_goal",
          "--command",
          "goal",
          "--share",
          action,
        ])
        opencode.expectExit(result, 0)
        expect(result.stdout).toBe(`Goal control: ${action || "status"}\n`)
      }
      expect(calls).toEqual(
        Array.from({ length: 3 }, () => ["GET /session/ses_goal", "POST /session/ses_goal/command"]).flat(),
      )
    }),
  60_000,
)
