import { afterAll, expect, test } from "bun:test"
import { Effect } from "effect"
import { ChildProcess } from "effect/process"
import { backendSupport, prepareCommand } from "@kilocode/sandbox"
import { Session } from "@opencode/schema/session"
import * as SandboxPolicy from "../../src/sandbox/policy"
import { cleanup, harness, provide, tempdir, type Harness } from "./support"

afterAll(cleanup)

const sandboxed = backendSupport({ mode: "deny", allowedHosts: [] }).available ? test : test.skip
const open = backendSupport({ mode: "allow", allowedHosts: [] }).available ? test : test.skip
const id = (value: string) => Session.ID.make(value)

const script = `
setTimeout(() => process.exit(4), 5000)
try {
  await Bun.connect({
    hostname: "127.0.0.1",
    port: Number(process.env.TEST_PORT),
    socket: {
      open() {},
      data(socket, chunk) {
        process.stdout.write(chunk)
        socket.end()
        process.exit(0)
      },
      error() {
        process.exit(3)
      },
    },
  })
} catch {
  process.exit(3)
}
`

function server() {
  let accepted = 0
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        accepted++
        socket.write("shell-network-ok")
        socket.end()
      },
      data() {},
    },
  })
  return { listener, accepted: () => accepted }
}

function spawn(command: ChildProcess.StandardCommand) {
  return Effect.promise(async () => {
    const child = Bun.spawn([command.command, ...command.args], {
      cwd: command.options.cwd,
      env: command.options.env ?? process.env,
      stdout: "pipe",
      stderr: "pipe",
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    return { code, stdout, stderr }
  })
}

function shell(value: Harness, sessionID: Session.ID, port: number) {
  return SandboxPolicy.executeTool(
    sessionID,
    { id: "shell" },
    Effect.scoped(
      Effect.gen(function* () {
        const command = yield* prepareCommand(
          ChildProcess.make(process.execPath, ["-e", script]),
          value.directory,
          { ...process.env, TEST_PORT: String(port) },
        )
        return yield* spawn(command)
      }),
    ),
  )
}

open("allows a shell command to reach the network when the configured network is allowed", async () => {
  const directory = await tempdir()
  const target = server()
  const value = harness({ directory, config: { sandbox: { enabled: true, network: "allow" } } })
  const port = target.listener.port!

  try {
    const result = await Effect.runPromise(provide(value, shell(value, id("ses_shell_allow"), port)))
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("shell-network-ok")
    expect(target.accepted()).toBe(1)
  } finally {
    target.listener.stop(true)
  }
})

sandboxed("denies a shell command network access when the configured network is denied", async () => {
  const directory = await tempdir()
  const target = server()
  const value = harness({ directory, config: { sandbox: { enabled: true, network: "deny" } } })
  const port = target.listener.port!

  try {
    const result = await Effect.runPromise(provide(value, shell(value, id("ses_shell_deny"), port)))
    expect(result.stdout).not.toContain("shell-network-ok")
    expect(result.code).not.toBe(0)
    expect(target.accepted()).toBe(0)
  } finally {
    target.listener.stop(true)
  }
})
