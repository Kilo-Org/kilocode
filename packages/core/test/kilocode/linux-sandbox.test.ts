import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createSocket } from "node:dgram"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { backendSupport, run, type Profile } from "@kilocode/sandbox"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

const linux = process.platform === "linux" ? test : test.skip
const linuxIPv6 = process.platform === "linux" && supportsIPv6() ? test : test.skip

function profile(
  allow: ReadonlyArray<string>,
  denyNames: ReadonlyArray<string> = [],
  mode: Profile["network"]["mode"] = "allow",
): Profile {
  return {
    filesystem: {
      allowWrite: allow.map((path) => ({ path, kind: "subtree" })),
      denyWrite: [],
      denyNames,
    },
    network: { mode, allowedHosts: [] },
    environment: { deny: [], set: {} },
  }
}

function denied(base: Profile, rules: Profile["filesystem"]["denyWrite"]): Profile {
  return { ...base, filesystem: { ...base.filesystem, denyWrite: rules } }
}

function spawn(script: string, cwd: string, policy: Profile) {
  return Effect.scoped(
    run(
      policy,
      ChildProcessSpawner.ChildProcessSpawner.use((spawner) =>
        spawner
          .spawn(ChildProcess.make(process.execPath, ["-e", script], { cwd }))
          .pipe(Effect.flatMap((handle) => handle.exitCode)),
      ),
    ).pipe(Effect.provide(CrossSpawnSpawner.defaultLayer)),
  )
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-linux-sandbox-"))
  const project = path.join(root, "project")
  const outside = path.join(root, "outside")
  await fs.mkdir(project)
  await fs.mkdir(outside)
  return { root, project, outside }
}

function requireNetwork() {
  const support = backendSupport({ mode: "deny", allowedHosts: [] })
  expect(support.available, support.reason).toBe(true)
}

function tcp(hostname = "127.0.0.1") {
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
  return { listener, accepted: () => accepted }
}

function supportsIPv6() {
  if (process.platform !== "linux") return false
  try {
    const probe = tcp("::1")
    probe.listener.stop(true)
    return true
  } catch {
    return false
  }
}

async function udp() {
  let received = 0
  const socket = createSocket("udp4")
  socket.on("message", (_message, peer) => {
    received++
    socket.send("sandbox-udp-ok", peer.port, peer.address)
  })
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject)
    socket.bind(0, "127.0.0.1", () => {
      socket.off("error", reject)
      resolve()
    })
  })
  const address = socket.address()
  if (typeof address === "string") throw new Error("UDP server did not expose an IP address")
  return { socket, port: address.port, received: () => received }
}

function tcpClient(port: number, expected: boolean, hostname = "127.0.0.1") {
  return [
    'const net = require("node:net")',
    `const socket = net.connect({ host: ${JSON.stringify(hostname)}, port: ${port} })`,
    `const expected = ${expected}`,
    'socket.on("data", (data) => process.exit(expected && data.toString() === "sandbox-tcp-ok" ? 0 : 2))',
    'socket.on("error", () => process.exit(expected ? 3 : 0))',
    "setTimeout(() => process.exit(expected ? 4 : 0), 1000)",
  ].join("\n")
}

function udpClient(port: number, expected: boolean) {
  return [
    'const dgram = require("node:dgram")',
    'const socket = dgram.createSocket("udp4")',
    `const expected = ${expected}`,
    'socket.on("message", (data) => process.exit(expected && data.toString() === "sandbox-udp-ok" ? 0 : 2))',
    'socket.on("error", () => process.exit(expected ? 3 : 0))',
    `socket.send("probe", ${port}, "127.0.0.1", (error) => { if (error) process.exit(expected ? 4 : 0) })`,
    "setTimeout(() => process.exit(expected ? 5 : 0), 500)",
  ].join("\n")
}

linux("confines writes from spawned processes to the profile allowlist", async () => {
  const support = backendSupport()
  expect(support.available, support.reason).toBe(true)
  const root = await fixture()
  const allowed = path.join(root.project, "allowed.txt")
  const sentinel = path.join(root.outside, "sentinel.txt")
  await fs.writeFile(sentinel, "original")

  const script = [
    'const fs = require("node:fs")',
    `fs.writeFileSync(${JSON.stringify(allowed)}, "allowed")`,
    "try {",
    `  fs.writeFileSync(${JSON.stringify(sentinel)}, "escaped")`,
    "  process.exit(2)",
    "} catch {",
    "  process.exit(0)",
    "}",
  ].join("\n")

  try {
    expect(Number(await Effect.runPromise(spawn(script, root.project, profile([root.project]))))).toBe(0)
    expect(await fs.readFile(allowed, "utf8")).toBe("allowed")
    expect(await fs.readFile(sentinel, "utf8")).toBe("original")
  } finally {
    await fs.rm(root.root, { recursive: true, force: true })
  }
})

linux("allows host loopback TCP in network allow mode and blocks it in deny mode", async () => {
  requireNetwork()
  const root = await fixture()
  const allowed = tcp()
  const blocked = tcp()

  try {
    const allow = profile([root.project], [], "allow")
    const deny = profile([root.project], [], "deny")
    expect(Number(await Effect.runPromise(spawn(tcpClient(allowed.listener.port, true), root.project, allow)))).toBe(0)
    expect(Number(await Effect.runPromise(spawn(tcpClient(blocked.listener.port, false), root.project, deny)))).toBe(0)
    expect(allowed.accepted()).toBe(1)
    expect(blocked.accepted()).toBe(0)
  } finally {
    allowed.listener.stop(true)
    blocked.listener.stop(true)
    await fs.rm(root.root, { recursive: true, force: true })
  }
})

linux("blocks UDP datagrams in network deny mode", async () => {
  requireNetwork()
  const root = await fixture()
  const allowed = await udp()
  const blocked = await udp()

  try {
    const allow = profile([root.project], [], "allow")
    const deny = profile([root.project], [], "deny")
    expect(Number(await Effect.runPromise(spawn(udpClient(allowed.port, true), root.project, allow)))).toBe(0)
    expect(Number(await Effect.runPromise(spawn(udpClient(blocked.port, false), root.project, deny)))).toBe(0)
    expect(allowed.received()).toBe(1)
    expect(blocked.received()).toBe(0)
  } finally {
    allowed.socket.close()
    blocked.socket.close()
    await fs.rm(root.root, { recursive: true, force: true })
  }
})

linux("blocks localhost connections in network deny mode", async () => {
  requireNetwork()
  const root = await fixture()
  const listener = tcp()
  const deny = profile([root.project], [], "deny")

  try {
    expect(
      Number(await Effect.runPromise(spawn(tcpClient(listener.listener.port, false, "localhost"), root.project, deny))),
    ).toBe(0)
    expect(listener.accepted()).toBe(0)
  } finally {
    listener.listener.stop(true)
    await fs.rm(root.root, { recursive: true, force: true })
  }
})

linuxIPv6("blocks IPv6 loopback connections in network deny mode", async () => {
  requireNetwork()
  const root = await fixture()
  const listener = tcp("::1")
  const deny = profile([root.project], [], "deny")

  try {
    expect(
      Number(await Effect.runPromise(spawn(tcpClient(listener.listener.port, false, "::1"), root.project, deny))),
    ).toBe(0)
    expect(listener.accepted()).toBe(0)
  } finally {
    listener.listener.stop(true)
    await fs.rm(root.root, { recursive: true, force: true })
  }
})

linux("keeps loopback available between processes inside the denied network namespace", async () => {
  requireNetwork()
  const root = await fixture()
  const child = [
    'const net = require("node:net")',
    "const port = Number(process.argv[1])",
    'const socket = net.connect({ host: "127.0.0.1", port })',
    'socket.on("connect", () => socket.write("sandbox-internal-ok"))',
    'socket.on("data", (data) => process.exit(data.toString() === "sandbox-internal-ok" ? 0 : 2))',
    'socket.on("error", () => process.exit(3))',
  ].join("\n")
  const script = [
    'const child = require("node:child_process")',
    'const net = require("node:net")',
    'const server = net.createServer((socket) => socket.on("data", (data) => socket.end(data)))',
    'server.listen(0, "127.0.0.1", () => {',
    `  const proc = child.spawn(process.execPath, ["-e", ${JSON.stringify(child)}, String(server.address().port)])`,
    '  proc.on("exit", (code) => process.exit(code ?? 4))',
    "})",
  ].join("\n")

  try {
    expect(Number(await Effect.runPromise(spawn(script, root.project, profile([root.project], [], "deny"))))).toBe(0)
  } finally {
    await fs.rm(root.root, { recursive: true, force: true })
  }
})

linux("keeps descendants in the denied network namespace", async () => {
  requireNetwork()
  const root = await fixture()
  const blocked = tcp()
  const child = tcpClient(blocked.listener.port, false)
  const script = [
    'const child = require("node:child_process")',
    `const result = child.spawnSync(process.execPath, ["-e", ${JSON.stringify(child)}])`,
    "process.exit(result.status ?? 3)",
  ].join("\n")

  try {
    expect(Number(await Effect.runPromise(spawn(script, root.project, profile([root.project], [], "deny"))))).toBe(0)
    expect(blocked.accepted()).toBe(0)
  } finally {
    blocked.listener.stop(true)
    await fs.rm(root.root, { recursive: true, force: true })
  }
})

linux("preserves filesystem confinement in network deny mode", async () => {
  requireNetwork()
  const root = await fixture()
  const allowed = path.join(root.project, "network-deny.txt")
  const sentinel = path.join(root.outside, "network-deny.txt")
  await fs.writeFile(sentinel, "original")
  const script = [
    'const fs = require("node:fs")',
    `fs.writeFileSync(${JSON.stringify(allowed)}, "allowed")`,
    "try {",
    `  fs.writeFileSync(${JSON.stringify(sentinel)}, "escaped")`,
    "  process.exit(2)",
    "} catch {",
    "  process.exit(0)",
    "}",
  ].join("\n")

  try {
    expect(Number(await Effect.runPromise(spawn(script, root.project, profile([root.project], [], "deny"))))).toBe(0)
    expect(await fs.readFile(allowed, "utf8")).toBe("allowed")
    expect(await fs.readFile(sentinel, "utf8")).toBe("original")
  } finally {
    await fs.rm(root.root, { recursive: true, force: true })
  }
})

linux("keeps reads available when no paths are writable", async () => {
  const root = await fixture()
  const sentinel = path.join(root.project, "sentinel.txt")
  await fs.writeFile(sentinel, "original")
  const script = [
    'const fs = require("node:fs")',
    `if (fs.readFileSync(${JSON.stringify(sentinel)}, "utf8") !== "original") process.exit(2)`,
    "try {",
    `  fs.writeFileSync(${JSON.stringify(sentinel)}, "escaped")`,
    "  process.exit(3)",
    "} catch {",
    "  process.exit(0)",
    "}",
  ].join("\n")

  try {
    expect(Number(await Effect.runPromise(spawn(script, root.project, profile([]))))).toBe(0)
    expect(await fs.readFile(sentinel, "utf8")).toBe("original")
  } finally {
    await fs.rm(root.root, { recursive: true, force: true })
  }
})

linux("keeps existing git metadata read-only under a writable project", async () => {
  const root = await fixture()
  const git = path.join(root.project, ".git")
  const config = path.join(git, "config")
  const allowed = path.join(root.project, "allowed.txt")
  await fs.mkdir(git)
  await fs.writeFile(config, "original")

  const script = [
    'const fs = require("node:fs")',
    `fs.writeFileSync(${JSON.stringify(allowed)}, "allowed")`,
    "try {",
    `  fs.writeFileSync(${JSON.stringify(config)}, "escaped")`,
    "  process.exit(2)",
    "} catch {",
    "  process.exit(0)",
    "}",
  ].join("\n")

  try {
    expect(Number(await Effect.runPromise(spawn(script, root.project, profile([root.project], [".git"]))))).toBe(0)
    expect(await fs.readFile(allowed, "utf8")).toBe("allowed")
    expect(await fs.readFile(config, "utf8")).toBe("original")
  } finally {
    await fs.rm(root.root, { recursive: true, force: true })
  }
})

linux("keeps existing nested git metadata read-only", async () => {
  const root = await fixture()
  const git = path.join(root.project, "packages", "nested", ".git")
  const config = path.join(git, "config")
  const allowed = path.join(root.project, "allowed.txt")
  await fs.mkdir(git, { recursive: true })
  await fs.writeFile(config, "original")
  const script = [
    'const fs = require("node:fs")',
    `fs.writeFileSync(${JSON.stringify(allowed)}, "allowed")`,
    "try {",
    `  fs.writeFileSync(${JSON.stringify(config)}, "escaped")`,
    "  process.exit(2)",
    "} catch {",
    "  process.exit(0)",
    "}",
  ].join("\n")

  try {
    expect(Number(await Effect.runPromise(spawn(script, root.project, profile([root.project], [".git"]))))).toBe(0)
    expect(await fs.readFile(config, "utf8")).toBe("original")
  } finally {
    await fs.rm(root.root, { recursive: true, force: true })
  }
})

linux("keeps worktree git marker files read-only", async () => {
  const root = await fixture()
  const marker = path.join(root.project, ".git")
  const renamed = path.join(root.project, ".git-moved")
  await fs.writeFile(marker, "gitdir: /outside")
  const script = [
    'const fs = require("node:fs")',
    "let blocked = 0",
    `try { fs.writeFileSync(${JSON.stringify(marker)}, "escaped") } catch { blocked++ }`,
    `try { fs.renameSync(${JSON.stringify(marker)}, ${JSON.stringify(renamed)}) } catch { blocked++ }`,
    "process.exit(blocked === 2 ? 0 : 2)",
  ].join("\n")

  try {
    expect(Number(await Effect.runPromise(spawn(script, root.project, profile([root.project], [".git"]))))).toBe(0)
    expect(await fs.readFile(marker, "utf8")).toBe("gitdir: /outside")
    expect(
      await fs.stat(renamed).then(
        () => true,
        () => false,
      ),
    ).toBe(false)
  } finally {
    await fs.rm(root.root, { recursive: true, force: true })
  }
})

linux("applies explicit file and subtree denies after a writable parent", async () => {
  const root = await fixture()
  const file = path.join(root.project, "protected.txt")
  const dir = path.join(root.project, "protected")
  const nested = path.join(dir, "value.txt")
  const allowed = path.join(root.project, "allowed.txt")
  await fs.writeFile(file, "original")
  await fs.mkdir(dir)
  await fs.writeFile(nested, "original")
  const policy = denied(profile([root.project]), [
    { path: file, kind: "literal" },
    { path: dir, kind: "subtree" },
  ])
  const script = [
    'const fs = require("node:fs")',
    `fs.writeFileSync(${JSON.stringify(allowed)}, "allowed")`,
    "let blocked = 0",
    `try { fs.writeFileSync(${JSON.stringify(file)}, "escaped") } catch { blocked++ }`,
    `try { fs.writeFileSync(${JSON.stringify(nested)}, "escaped") } catch { blocked++ }`,
    "process.exit(blocked === 2 ? 0 : 2)",
  ].join("\n")

  try {
    expect(Number(await Effect.runPromise(spawn(script, root.project, policy)))).toBe(0)
    expect(await fs.readFile(allowed, "utf8")).toBe("allowed")
    expect(await fs.readFile(file, "utf8")).toBe("original")
    expect(await fs.readFile(nested, "utf8")).toBe("original")
  } finally {
    await fs.rm(root.root, { recursive: true, force: true })
  }
})

linux("prevents renaming denied policy state while sibling state remains writable", async () => {
  const root = await fixture()
  const state = path.join(root.project, "state")
  const store = path.join(root.project, "policy")
  const sibling = path.join(state, "sibling.txt")
  const moved = path.join(state, "moved")
  await fs.mkdir(state)
  await fs.mkdir(store)
  const policy = denied(profile([state]), [{ path: store, kind: "subtree" }])
  const script = [
    'const fs = require("node:fs")',
    `fs.writeFileSync(${JSON.stringify(sibling)}, "allowed")`,
    `try { fs.renameSync(${JSON.stringify(store)}, ${JSON.stringify(moved)}); process.exit(2) } catch {}`,
  ].join("\n")

  try {
    expect(Number(await Effect.runPromise(spawn(script, root.project, policy)))).toBe(0)
    expect(await fs.readFile(sibling, "utf8")).toBe("allowed")
    expect((await fs.stat(store)).isDirectory()).toBe(true)
  } finally {
    await fs.rm(root.root, { recursive: true, force: true })
  }
})

linux("supports writable literal files without opening writable siblings", async () => {
  const root = await fixture()
  const allowed = path.join(root.project, "allowed.txt")
  const sibling = path.join(root.project, "sibling.txt")
  await fs.writeFile(allowed, "original")
  await fs.writeFile(sibling, "original")
  const base = profile([])
  const policy: Profile = {
    ...base,
    filesystem: { ...base.filesystem, allowWrite: [{ path: allowed, kind: "literal" }] },
  }
  const script = [
    'const fs = require("node:fs")',
    `fs.writeFileSync(${JSON.stringify(allowed)}, "allowed")`,
    "try {",
    `  fs.writeFileSync(${JSON.stringify(sibling)}, "escaped")`,
    "  process.exit(2)",
    "} catch {",
    "  process.exit(0)",
    "}",
  ].join("\n")

  try {
    expect(Number(await Effect.runPromise(spawn(script, root.project, policy)))).toBe(0)
    expect(await fs.readFile(allowed, "utf8")).toBe("allowed")
    expect(await fs.readFile(sibling, "utf8")).toBe("original")
  } finally {
    await fs.rm(root.root, { recursive: true, force: true })
  }
})

linux("blocks writes through a project symlink to an outside path", async () => {
  const root = await fixture()
  const sentinel = path.join(root.outside, "sentinel.txt")
  const link = path.join(root.project, "outside")
  await fs.writeFile(sentinel, "original")
  await fs.symlink(root.outside, link)

  const script = [
    'const fs = require("node:fs")',
    "try {",
    `  fs.writeFileSync(${JSON.stringify(path.join(link, "sentinel.txt"))}, "escaped")`,
    "  process.exit(2)",
    "} catch {",
    "  process.exit(0)",
    "}",
  ].join("\n")

  try {
    expect(Number(await Effect.runPromise(spawn(script, root.project, profile([root.project]))))).toBe(0)
    expect(await fs.readFile(sentinel, "utf8")).toBe("original")
  } finally {
    await fs.rm(root.root, { recursive: true, force: true })
  }
})

linux("allows every profile root including configured temp and cache paths", async () => {
  const root = await fixture()
  const temp = path.join(root.root, "temp")
  const cache = path.join(root.root, "cache")
  await fs.mkdir(temp)
  await fs.mkdir(cache)
  const base = profile([root.project, temp, cache])
  const policy: Profile = {
    ...base,
    filesystem: { ...base.filesystem, temporaryDirectory: temp },
    environment: { ...base.environment, set: { TMPDIR: temp } },
  }

  const files = [path.join(root.project, "project.txt"), path.join(temp, "temp.txt"), path.join(cache, "cache.txt")]
  const script = [
    'const fs = require("node:fs")',
    ...files.map((file) => `fs.writeFileSync(${JSON.stringify(file)}, "allowed")`),
    `if (process.env.TMPDIR !== ${JSON.stringify(temp)}) process.exit(2)`,
  ].join("\n")

  try {
    expect(Number(await Effect.runPromise(spawn(script, root.project, policy)))).toBe(0)
    expect(await Promise.all(files.map((file) => fs.readFile(file, "utf8")))).toEqual(["allowed", "allowed", "allowed"])
  } finally {
    await fs.rm(root.root, { recursive: true, force: true })
  }
})

linux("applies the profile environment without inheriting denied values", async () => {
  const root = await fixture()
  const base = profile([root.project])
  const policy: Profile = {
    ...base,
    environment: { deny: ["KILO_SANDBOX_DENIED"], set: { KILO_SANDBOX_SET: "expected" } },
  }
  const script = [
    'if (process.env.KILO_SANDBOX_SET !== "expected") process.exit(2)',
    "if (process.env.KILO_SANDBOX_DENIED !== undefined) process.exit(3)",
  ].join("\n")

  try {
    const effect = Effect.scoped(
      run(
        policy,
        ChildProcessSpawner.ChildProcessSpawner.use((spawner) =>
          spawner
            .spawn(
              ChildProcess.make(process.execPath, ["-e", script], {
                cwd: root.project,
                env: { KILO_SANDBOX_DENIED: "ambient" },
                extendEnv: true,
              }),
            )
            .pipe(Effect.flatMap((handle) => handle.exitCode)),
        ),
      ).pipe(Effect.provide(CrossSpawnSpawner.defaultLayer)),
    )
    expect(Number(await Effect.runPromise(effect))).toBe(0)
  } finally {
    await fs.rm(root.root, { recursive: true, force: true })
  }
})

linux("confines writes from descendant processes", async () => {
  const root = await fixture()
  const allowed = path.join(root.project, "child.txt")
  const sentinel = path.join(root.outside, "sentinel.txt")
  await fs.writeFile(sentinel, "original")
  const child = [
    'const fs = require("node:fs")',
    `fs.writeFileSync(${JSON.stringify(allowed)}, "allowed")`,
    "try {",
    `  fs.writeFileSync(${JSON.stringify(sentinel)}, "escaped")`,
    "  process.exit(2)",
    "} catch {",
    "  process.exit(0)",
    "}",
  ].join("\n")
  const script = [
    'const child = require("node:child_process")',
    `const result = child.spawnSync(process.execPath, ["-e", ${JSON.stringify(child)}])`,
    "process.exit(result.status ?? 3)",
  ].join("\n")

  try {
    expect(Number(await Effect.runPromise(spawn(script, root.project, profile([root.project]))))).toBe(0)
    expect(await fs.readFile(allowed, "utf8")).toBe("allowed")
    expect(await fs.readFile(sentinel, "utf8")).toBe("original")
  } finally {
    await fs.rm(root.root, { recursive: true, force: true })
  }
})

linux("terminates daemonized descendants when the command scope closes", async () => {
  const root = await fixture()
  const ready = path.join(root.project, "ready")
  const marker = path.join(root.project, "marker")
  const child = [
    'const fs = require("node:fs")',
    `setInterval(() => fs.writeFileSync(${JSON.stringify(marker)}, String(Date.now())), 20)`,
  ].join("\n")
  const script = [
    'const fs = require("node:fs")',
    'const child = require("node:child_process")',
    `const proc = child.spawn(process.execPath, ["-e", ${JSON.stringify(child)}], { detached: true, stdio: "ignore" })`,
    "proc.unref()",
    `fs.writeFileSync(${JSON.stringify(ready)}, "ready")`,
    "setInterval(() => {}, 10_000)",
  ].join("\n")

  try {
    await Effect.runPromise(
      Effect.scoped(
        run(
          profile([root.project]),
          ChildProcessSpawner.ChildProcessSpawner.use((spawner) =>
            Effect.gen(function* () {
              yield* spawner.spawn(ChildProcess.make(process.execPath, ["-e", script], { cwd: root.project }))
              yield* Effect.promise(async () => {
                const deadline = Date.now() + 5_000
                while (Date.now() < deadline) {
                  const started = await Promise.all(
                    [ready, marker].map((file) =>
                      fs.stat(file).then(
                        () => true,
                        () => false,
                      ),
                    ),
                  )
                  if (started.every(Boolean)) return
                  await Bun.sleep(20)
                }
                throw new Error("daemonized child did not start")
              })
            }),
          ),
        ).pipe(Effect.provide(CrossSpawnSpawner.defaultLayer)),
      ),
    )

    await Bun.sleep(100)
    const stopped = await fs.readFile(marker, "utf8")
    await Bun.sleep(150)
    expect(await fs.readFile(marker, "utf8")).toBe(stopped)
  } finally {
    await fs.rm(root.root, { recursive: true, force: true })
  }
})

linux("rejects a Bubblewrap helper inside a writable root", async () => {
  const root = await fixture()
  const source = process.env.KILO_BWRAP_PATH ?? "/usr/bin/bwrap"
  const helper = path.join(root.project, "bwrap")
  const link = path.join(root.outside, "bwrap")
  await fs.copyFile(source, helper)
  await fs.chmod(helper, 0o755)
  await fs.symlink(helper, link)
  const script = [
    'import { Effect } from "effect"',
    'import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"',
    'import { backendSupport, run } from "@kilocode/sandbox"',
    'import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"',
    "if (!backendSupport().available) process.exit(2)",
    `const profile = { filesystem: { allowWrite: [{ path: ${JSON.stringify(root.project)}, kind: "subtree" }], denyWrite: [], denyNames: [] }, network: { mode: "allow", allowedHosts: [] }, environment: { deny: [], set: {} } }`,
    'const effect = Effect.scoped(run(profile, ChildProcessSpawner.ChildProcessSpawner.use((spawner) => spawner.spawn(ChildProcess.make(process.execPath, ["-e", "process.exit(0)"])))).pipe(Effect.provide(CrossSpawnSpawner.defaultLayer)))',
    "try { await Effect.runPromise(effect); process.exit(3) } catch { process.exit(0) }",
  ].join("\n")

  try {
    const result = spawnSync(process.execPath, ["-e", script], {
      cwd: import.meta.dir,
      env: { ...process.env, KILO_BWRAP_PATH: link },
      encoding: "utf8",
    })
    expect(result.status, result.stderr).toBe(0)
  } finally {
    await fs.rm(root.root, { recursive: true, force: true })
  }
})

linux("reports network namespace support separately and fails deny mode closed", async () => {
  const root = await fixture()
  const source = process.env.KILO_BWRAP_PATH ?? "/usr/bin/bwrap"
  const helper = path.join(root.outside, "bwrap-no-network")
  await fs.writeFile(
    helper,
    [
      "#!/bin/sh",
      'for arg in "$@"; do',
      '  if [ "$arg" = "--unshare-net" ]; then echo "network namespaces blocked" >&2; exit 42; fi',
      "done",
      `exec ${JSON.stringify(source)} "$@"`,
      "",
    ].join("\n"),
  )
  await fs.chmod(helper, 0o755)
  const script = [
    'import { Effect } from "effect"',
    'import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"',
    'import { backendSupport, run } from "@kilocode/sandbox"',
    'import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"',
    'const allow = backendSupport({ mode: "allow", allowedHosts: [] })',
    'const deny = backendSupport({ mode: "deny", allowedHosts: [] })',
    "if (!allow.available) process.exit(2)",
    'if (deny.available || !deny.reason?.includes("Linux network sandbox")) process.exit(3)',
    'const profile = { filesystem: { allowWrite: [], denyWrite: [], denyNames: [] }, network: { mode: "deny", allowedHosts: [] }, environment: { deny: [], set: {} } }',
    'const effect = Effect.scoped(run(profile, ChildProcessSpawner.ChildProcessSpawner.use((spawner) => spawner.spawn(ChildProcess.make(process.execPath, ["-e", "process.exit(0)"])))).pipe(Effect.provide(CrossSpawnSpawner.defaultLayer)))',
    "try { await Effect.runPromise(effect); process.exit(4) } catch { process.exit(0) }",
  ].join("\n")

  try {
    const result = spawnSync(process.execPath, ["-e", script], {
      cwd: import.meta.dir,
      env: { ...process.env, KILO_BWRAP_PATH: helper },
      encoding: "utf8",
    })
    expect(result.status, result.stderr).toBe(0)
  } finally {
    await fs.rm(root.root, { recursive: true, force: true })
  }
})

linux("fails closed when Bubblewrap is unavailable", () => {
  const script = [
    'import { Effect } from "effect"',
    'import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"',
    'import { backendSupport, run } from "@kilocode/sandbox"',
    'import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"',
    "if (backendSupport().available) process.exit(2)",
    'const profile = { filesystem: { allowWrite: [], denyWrite: [], denyNames: [] }, network: { mode: "allow", allowedHosts: [] }, environment: { deny: [], set: {} } }',
    'const effect = Effect.scoped(run(profile, ChildProcessSpawner.ChildProcessSpawner.use((spawner) => spawner.spawn(ChildProcess.make(process.execPath, ["-e", "process.exit(0)"])))).pipe(Effect.provide(CrossSpawnSpawner.defaultLayer)))',
    "try { await Effect.runPromise(effect); process.exit(3) } catch { process.exit(0) }",
  ].join("\n")
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: import.meta.dir,
    env: { ...process.env, KILO_BWRAP_PATH: "/missing/kilo-bwrap" },
    encoding: "utf8",
  })
  expect(result.status, result.stderr).toBe(0)
})
