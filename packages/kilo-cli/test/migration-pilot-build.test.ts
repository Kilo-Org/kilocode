import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, statfsSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"

// In build smoke runs, test the actual executable while trying to override its embedded choice.
const binary = process.env.KILO_V2_TEST_BINARY && path.resolve(process.env.KILO_V2_TEST_BINARY)
const wrapper = path.resolve(import.meta.dir, "../../../script/dev-isolated.ts")

test(`${binary ? "packaged" : "source"} host preserves v1 until consent and reopens the same stable profile`, async () => {
  await using profile = await tmpdir("kilo-pilot-")
  const root = profile.path
  mkdirSync(path.join(root, ".git"))
  const source = path.join(root, "data/kilo/kilo.db")
  mkdirSync(path.dirname(source), { recursive: true })
  {
    using db = new Database(source)
    db.exec(readFileSync(path.join(import.meta.dir, "fixture/kilo-v1-schema.sql"), "utf8"))
    db.run("INSERT INTO project (id, worktree, time_created, time_updated, sandboxes) VALUES ('global','/',1,1,'[]')")
    db.run(
      "INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated) VALUES ('ses_pilot','global','pilot',?,'Synthetic build smoke','7',1,1)",
      [root],
    )
  }
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    HOME: path.join(root, "home"),
    USERPROFILE: path.join(root, "home"),
    TMPDIR: path.join(root, "tmp"),
    TMP: path.join(root, "tmp"),
    TEMP: path.join(root, "tmp"),
    LANG: "en_US.UTF-8",
    KILO_V2_PROFILE: root,
    KILO_V2_TEST_BINARY: binary,
  }
  const run = (...args: string[]) =>
    Bun.spawnSync([process.execPath, wrapper, ...args], { cwd: root, env, stdin: "ignore" })
  const blocked = run("debug", "paths")
  expect(blocked.exitCode).not.toBe(0)
  expect(blocked.stderr.toString()).toContain("--accept-jetbrains-breakage")
  expect(existsSync(`${source}.pre-v2`)).toBe(false)
  const original = readFileSync(source)
  const declined = await accept(root, env, "\r")
  expect(declined.code).toBe(0)
  expect(readFileSync(source)).toEqual(original)
  expect(existsSync(`${source}.pre-v2`)).toBe(false)
  const result = await accept(root, env)
  if (!supportedVolume(root)) {
    expect(result.code).not.toBe(0)
    expect(result.text).toContain("Safe database replacement requires local APFS, ext4, XFS or Btrfs")
    expect(existsSync(`${source}.pre-v2`)).toBe(false)
    return
  }
  expect(result.code, result.text).toBe(0)
  expectPaths(result.text, root, "kilo") // The command that displayed the confirmation, not just the next launch.
  const again = run("debug", "paths")
  expect(again.exitCode, again.stderr.toString()).toBe(0)
  expectPaths(again.stdout.toString(), root, "kilo")
  expect(existsSync(`${source}.pre-v2`)).toBe(true)
}, 90_000)

function supportedVolume(root: string) {
  if (process.platform === "darwin") return Bun.spawnSync(["/bin/df", "-t", "apfs", root]).exitCode === 0
  return process.platform === "linux" && [0xef53, 0x58465342, 0x9123683e].includes(statfsSync(root).type >>> 0)
}

function expectPaths(output: string, root: string, app: string) {
  const paths = Object.fromEntries(output.split("\n").map((line) => line.trim().split(/\s+(.+)/)))
  for (const key of ["data", "state", "config", "cache", "tmp"]) expect(paths[key]).toBe(path.join(root, key, app))
  if (app === "kilo") expect(paths.db).toBe(path.join(root, "data/kilo/kilo.db"))
}

async function accept(cwd: string, env: NodeJS.ProcessEnv, reply = "y\r") {
  let text = ""
  let replied = false
  const decoder = new TextDecoder()
  const terminal = new Bun.Terminal({
    cols: 160,
    data(tty, bytes) {
      text += decoder.decode(bytes, { stream: true })
      if (!replied && text.includes("[y/N]")) {
        replied = true
        tty.write(reply)
      }
    },
  })
  try {
    const child = Bun.spawn([process.execPath, wrapper, "debug", "paths"], { cwd, env, terminal, timeout: 60_000 })
    const code = await child.exited
    expect(replied, text).toBe(true)
    return { code, text: Bun.stripANSI(text).replaceAll("\r", "") }
  } finally {
    terminal.close()
  }
}

test("fresh service creates kilo.db and the next process recognizes native v2 without conversion", async () => {
  await using profile = await tmpdir("kilo-fresh-")
  const root = profile.path
  mkdirSync(path.join(root, ".git"))
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    HOME: root,
    USERPROFILE: root,
    KILO_V2_PROFILE: root,
    KILO_V2_TEST_BINARY: binary,
    OPENCODE_PASSWORD: "fixture",
    KILO_DISABLE_AUTOUPDATE: "1",
    KILO_DISABLE_MODELS_FETCH: "1",
  }
  const probe = () =>
    Bun.spawnSync([process.execPath, wrapper, "migrate", "preflight"], { cwd: root, env, stdin: "ignore" })
  expect(JSON.parse(probe().stdout.toString()).status).toBe("absent")
  const service = Bun.spawn([process.execPath, wrapper, "serve", "--stdio", "--port", "0"], {
    cwd: root,
    env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30000,
  })
  try {
    const stream = service.stdout.getReader()
    let output = ""
    while (!output.includes("\n")) {
      const next = await stream.read()
      if (next.done) throw new Error(await new Response(service.stderr).text())
      output += new TextDecoder().decode(next.value)
    }
    stream.releaseLock()
    const { url } = JSON.parse(output.split("\n")[0]!)
    const res = await fetch(new URL("/api/session", url), {
      headers: { authorization: `Basic ${btoa("opencode:fixture")}` },
    })
    expect(res.status).toBe(200)
    await res.body?.cancel()
  } finally {
    service.stdin.end()
    await service.exited
  }
  const source = path.join(root, "data/kilo/kilo.db")
  expect(existsSync(source)).toBe(true)
  {
    using db = new Database(source)
    db.run(
      "INSERT OR IGNORE INTO project(id,worktree,time_created,time_updated,sandboxes) VALUES('prj_native',?,1,1,'[]')",
      [root],
    )
    db.run(
      "INSERT INTO session_v2(id,project_id,slug,directory,title,version,time_created,time_updated) VALUES('ses_native','prj_native','native',?,'Native v2 history','2',1,1)",
      [root],
    )
  }
  expect(JSON.parse(probe().stdout.toString())).toMatchObject({ status: "native", source })
  const again = Bun.spawnSync([process.execPath, wrapper, "debug", "paths"], { cwd: root, env, stdin: "ignore" })
  expect(again.exitCode, again.stderr.toString()).toBe(0)
  expectPaths(again.stdout.toString(), root, "kilo")
  using native = new Database(source, { readonly: true })
  expect(native.query("SELECT title FROM session_v2 WHERE id='ses_native'").get()).toEqual({
    title: "Native v2 history",
  })
  expect(existsSync(`${source}.pre-v2`)).toBe(false)
}, 60000)
