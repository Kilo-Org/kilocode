import { afterAll, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { Effect } from "effect"
import { ChildProcess } from "effect/process"
import {
  backendSupport,
  CurrentProxyFactory,
  prepareCommand,
  startProxy,
  type ProxyFactory,
} from "@kilocode/sandbox"
import { Session } from "@opencode/schema/session"
import * as SandboxPolicy from "../../src/sandbox/policy"
import { cleanup, harness, provide, tempdir, type Harness } from "./support"

afterAll(cleanup)

const id = (value: string) => Session.ID.make(value)
const filesystem = backendSupport({ mode: "deny", allowedHosts: [] }).available ? test : test.skip
const proxy =
  process.platform === "darwin" && existsSync("/usr/bin/curl") && backendSupport({ mode: "proxy", allowedHosts: [] }).available
    ? test
    : test.skip

function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
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

function command(value: Harness, args: string[], env: Record<string, string | undefined> = process.env) {
  return Effect.scoped(
    Effect.gen(function* () {
      const prepared = yield* prepareCommand(ChildProcess.make(args[0]!, args.slice(1)), value.directory, env)
      return yield* spawn(prepared)
    }),
  )
}

function shell(value: Harness, sessionID: Session.ID, commandline: string) {
  return SandboxPolicy.executeTool(
    sessionID,
    { id: "shell" },
    command(value, ["/bin/sh", "-c", commandline]),
  )
}

async function enabled(value: Harness, sessionID: Session.ID) {
  const status = await Effect.runPromise(provide(value, SandboxPolicy.toggle(sessionID)))
  return status.available
}

filesystem("confines shell writes inside the workspace and denies outside and .git", async () => {
  const root = await tempdir()
  const project = path.join(root, "project")
  const outside = path.join(root, "outside")
  await Promise.all([fs.mkdir(project, { recursive: true }), fs.mkdir(outside, { recursive: true })])
  const value = harness({ directory: project })
  const sessionID = id("ses_confinement_write")
  if (!(await enabled(value, sessionID))) return

  const write = (file: string) => Effect.runPromise(provide(value, shell(value, sessionID, `printf confined > ${quote(file)}`)))
  const inside = path.join(project, "inside.txt")
  const escaped = path.join(outside, "outside.txt")
  const blocked = path.join(project, ".git", "blocked.txt")

  const [insideResult, escapedResult, gitResult] = await Promise.all([
    write(inside),
    write(escaped),
    write(blocked),
  ])

  expect(insideResult.code).toBe(0)
  expect(escapedResult.code).not.toBe(0)
  expect(gitResult.code).not.toBe(0)
  expect(await fs.readFile(inside, "utf8")).toBe("confined")
  expect(await fs.access(escaped).then(() => true, () => false)).toBe(false)
  expect(await fs.access(blocked).then(() => true, () => false)).toBe(false)

  await Effect.runPromise(provide(value, SandboxPolicy.toggle(sessionID)))
  expect((await write(escaped)).code).toBe(0)
})

filesystem("denies a direct connection while the network is denied", async () => {
  let accepted = 0
  const target = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        accepted++
        socket.end()
      },
      data() {},
    },
  })
  const directory = await tempdir()
  const value = harness({ directory, config: { sandbox: { enabled: true, network: "deny" } } })
  const sessionID = id("ses_confinement_deny")

  try {
    const result = await Effect.runPromise(
      provide(
        value,
        shell(
          value,
          sessionID,
          `${quote(process.execPath)} -e ${quote(
            `setTimeout(() => process.exit(4), 4000); Bun.connect({ hostname: "127.0.0.1", port: ${target.port}, socket: { open() {}, data() {} } }).then(() => process.exit(0), () => process.exit(3))`,
          )}`,
        ),
      ),
    )
    expect(result.code).not.toBe(0)
    expect(accepted).toBe(0)
  } finally {
    target.stop(true)
  }
})

proxy("routes the allowed host through the proxy and blocks every other host", async () => {
  let requests = 0
  const target = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      requests++
      return new Response("sandbox-proxy-ok")
    },
  })
  const port = target.port!
  const directory = await tempdir()
  const value = harness({
    directory,
    config: { sandbox: { enabled: true, network: "deny", allowed_hosts: [`allowed.test:${port}`] } },
  })
  const sessionID = id("ses_confinement_proxy")
  const status = await Effect.runPromise(provide(value, SandboxPolicy.status(sessionID)))
  if (!status.enabled) {
    await target.stop(true)
    return
  }
  const factory: ProxyFactory = (hosts) =>
    startProxy(hosts, process.platform, async (destination) => {
      if (destination.port !== port) throw new Error("unexpected port")
      return { address: "127.0.0.1", family: 4 }
    })
  const curl = (url: string) =>
    SandboxPolicy.executeTool(
      sessionID,
      { id: "shell" },
      command(value, ["/usr/bin/curl", "-sS", "--max-time", "5", "-w", "\\n%{http_code}", url]),
    ).pipe(Effect.provideService(CurrentProxyFactory, factory))

  try {
    const allowed = await Effect.runPromise(provide(value, curl(`http://allowed.test:${port}/allowed`)))
    expect(allowed.code).toBe(0)
    expect(allowed.stdout).toContain("sandbox-proxy-ok")
    expect(allowed.stdout).toContain("200")
    expect(requests).toBe(1)

    const blocked = await Effect.runPromise(provide(value, curl(`http://blocked.allowed.test:${port}/blocked`)))
    expect(blocked.code).toBe(0)
    expect(blocked.stdout).toContain("403")
    expect(requests).toBe(1)
  } finally {
    await target.stop(true)
  }
})
