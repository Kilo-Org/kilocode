import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { backendSupport, run, type Profile } from "@kilocode/sandbox"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

const linux = process.platform === "linux" ? test : test.skip

function profile(allow: ReadonlyArray<string>, denyNames: ReadonlyArray<string> = []): Profile {
  return {
    filesystem: {
      allowWrite: allow.map((path) => ({ path, kind: "subtree" })),
      denyWrite: [],
      denyNames,
    },
    network: { mode: "allow", allowedHosts: [] },
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
