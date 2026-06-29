import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { prepare, type Launch } from "../src/backend"
import { run } from "../src/context"
import type { Profile } from "../src/profile"

const mac = process.platform === "darwin" ? test : test.skip
const roots: string[] = []

function profile(root: string, mode: Profile["network"]["mode"]): Profile {
  return {
    filesystem: {
      allowWrite: [{ path: root, kind: "subtree" }],
      denyWrite: [],
      denyNames: [".protected"],
    },
    network: { mode, allowedHosts: [] },
    environment: { deny: [], set: {} },
  }
}

function prepareLaunch(profile: Profile, input: Launch) {
  return Effect.runPromise(Effect.scoped(run(profile, prepare(input))))
}

async function launch(profile: Profile, input: Launch) {
  const target = await prepareLaunch(profile, input)
  const child = Bun.spawn([target.command, ...target.args], {
    cwd: target.cwd,
    env: target.environment,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}

function server(hostname: string) {
  let accepted = 0
  const listener = Bun.listen({
    hostname,
    port: 0,
    socket: {
      open(socket) {
        accepted++
        socket.write("sandbox-tcp-ok")
        socket.end()
      },
      data() {},
    },
  })
  return {
    listener,
    accepted: () => accepted,
  }
}

function http() {
  let requests = 0
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      requests++
      return new Response("sandbox-http-ok")
    },
  })
  return { server, requests: () => requests }
}

async function root() {
  const dir = await mkdtemp(join(tmpdir(), "kilo-seatbelt-network-"))
  roots.push(dir)
  await mkdir(join(dir, ".protected"))
  return dir
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("macOS Seatbelt network integration", () => {
  mac("allows a sandboxed child to exchange loopback TCP data in allow mode", async () => {
    const dir = await root()
    const tcp = server("127.0.0.1")
    try {
      const result = await launch(profile(dir, "allow"), {
        command: "/usr/bin/nc",
        args: ["127.0.0.1", String(tcp.listener.port)],
        cwd: dir,
      })
      expect(result.code).toBe(0)
      expect(result.stdout).toBe("sandbox-tcp-ok")
      expect(tcp.accepted()).toBe(1)
    } finally {
      tcp.listener.stop(true)
    }
  })

  mac("allows a sandboxed child to listen for inbound loopback traffic in deny mode", async () => {
    const dir = await root()
    const probe = server("127.0.0.1")
    const port = probe.listener.port
    probe.listener.stop(true)
    const target = await prepareLaunch(profile(dir, "deny"), {
      command: "/usr/bin/nc",
      args: ["-l", "127.0.0.1", String(port)],
      cwd: dir,
    })
    const child = Bun.spawn([target.command, ...target.args], {
      cwd: target.cwd,
      env: target.environment,
      stdout: "pipe",
      stderr: "pipe",
    })
    const timeout = setTimeout(() => child.kill(), 5_000)
    try {
      const connected = await (async () => {
        for (const _ of Array.from({ length: 100 })) {
          const socket = await Bun.connect({
            hostname: "127.0.0.1",
            port,
            socket: {
              open(socket) {
                socket.write("sandbox-inbound-ok")
                socket.end()
              },
              data() {},
              error() {},
            },
          }).catch(() => undefined)
          if (socket) return true
          await Bun.sleep(20)
        }
        return false
      })()
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect(connected).toBe(true)
      expect(code).toBe(0)
      expect(stdout).toBe("sandbox-inbound-ok")
      expect(stderr).toBe("")
    } finally {
      clearTimeout(timeout)
      child.kill()
    }
  })

  mac("denies a sandboxed child loopback TCP connection with a kernel permission error", async () => {
    const dir = await root()
    const tcp = server("127.0.0.1")
    try {
      const result = await launch(profile(dir, "deny"), {
        command: "/usr/bin/nc",
        args: ["-v", "127.0.0.1", String(tcp.listener.port)],
        cwd: dir,
      })
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain("Operation not permitted")
      expect(tcp.accepted()).toBe(0)
    } finally {
      tcp.listener.stop(true)
    }
  })

  mac("enforces allow and deny modes for child HTTP requests", async () => {
    const dir = await root()
    const allowed = http()
    const denied = http()
    try {
      const allow = await launch(profile(dir, "allow"), {
        command: "/usr/bin/curl",
        args: ["--noproxy", "*", "-fsS", allowed.server.url.toString()],
        cwd: dir,
      })
      const deny = await launch(profile(dir, "deny"), {
        command: "/usr/bin/curl",
        args: ["--noproxy", "*", "-fsS", denied.server.url.toString()],
        cwd: dir,
      })
      expect(allow.code).toBe(0)
      expect(allow.stdout).toBe("sandbox-http-ok")
      expect(allowed.requests()).toBe(1)
      expect(deny.code).not.toBe(0)
      expect(denied.requests()).toBe(0)
    } finally {
      await Promise.all([allowed.server.stop(true), denied.server.stop(true)])
    }
  })

  mac("denies hostname and IPv6 loopback forms", async () => {
    const dir = await root()
    const ipv4 = server("127.0.0.1")
    const ipv6 = server("::1")
    try {
      const localhost = await launch(profile(dir, "deny"), {
        command: "/usr/bin/nc",
        args: ["-v", "localhost", String(ipv4.listener.port)],
        cwd: dir,
      })
      const direct = await launch(profile(dir, "deny"), {
        command: "/usr/bin/nc",
        args: ["-v", "::1", String(ipv6.listener.port)],
        cwd: dir,
      })
      expect(localhost.code).not.toBe(0)
      expect(localhost.stderr).toContain("Operation not permitted")
      expect(direct.code).not.toBe(0)
      expect(direct.stderr).toContain("Operation not permitted")
      expect(ipv4.accepted()).toBe(0)
      expect(ipv6.accepted()).toBe(0)
    } finally {
      ipv4.listener.stop(true)
      ipv6.listener.stop(true)
    }
  })

  for (const mode of ["allow", "deny"] as const) {
    mac(`preserves filesystem policy in ${mode} network mode`, async () => {
      const dir = await root()
      const outside = join(await root(), `${mode}.txt`)
      const allowed = join(dir, `${mode}.txt`)
      const blocked = join(dir, ".protected", `${mode}.txt`)
      const write = await launch(profile(dir, mode), {
        command: "/bin/sh",
        args: ["-c", 'printf allowed > "$1"', "sandbox-write", allowed],
        cwd: dir,
      })
      const deny = await launch(profile(dir, mode), {
        command: "/bin/sh",
        args: ["-c", 'printf blocked > "$1"', "sandbox-write", blocked],
        cwd: dir,
      })
      const escape = await launch(profile(dir, mode), {
        command: "/bin/sh",
        args: ["-c", 'printf blocked > "$1"', "sandbox-write", outside],
        cwd: dir,
      })
      expect(write.code).toBe(0)
      expect(await readFile(allowed, "utf8")).toBe("allowed")
      expect(deny.code).not.toBe(0)
      expect(await Bun.file(blocked).exists()).toBe(false)
      expect(escape.code).not.toBe(0)
      expect(await Bun.file(outside).exists()).toBe(false)
    })
  }
})
