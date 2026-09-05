import { expect, spyOn, test } from "bun:test"
import { Effect } from "effect"
import yargs from "yargs"
import { RunCommand } from "@/cli/cmd/run"
import { UI } from "@/cli/ui"
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

test.each(["Fix failing tests\n", " resume\n"])(
  "piped goal %j rejects before deferred session lookup",
  async (text) => {
    const calls: string[] = []
    using server = listen(calls)
    using stdin = spyOn(Bun.stdin, "text").mockResolvedValue(text)
    using error = spyOn(UI, "error").mockImplementation(() => {})
    using exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("headless goal rejected")
    })
    const tty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY")
    const code = process.exitCode
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false })
    try {
      const failure = await yargs()
        .command(RunCommand)
        .exitProcess(false)
        .fail((message, err) => {
          throw err ?? new Error(message)
        })
        .parseAsync([
          "run",
          "--command",
          "goal",
          "--session",
          "ses_goal",
          "--fork",
          "--share",
          "--attach",
          server.url.toString(),
        ])
        .then(
          () => undefined,
          (err: unknown) => err,
        )
      expect(failure).toBeInstanceOf(Error)
      expect(String(failure)).toContain("headless goal rejected")
      expect(stdin).toHaveBeenCalledTimes(1)
      expect(error).toHaveBeenCalledWith(diagnostic)
      expect(exit).toHaveBeenCalledWith(1)
      expect(calls).toEqual([])
    } finally {
      process.exitCode = code ?? 0
      if (tty) Object.defineProperty(process.stdin, "isTTY", tty)
      if (!tty) delete (process.stdin as { isTTY?: boolean }).isTTY
    }
  },
)

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
