import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"

const fixture = path.join(import.meta.dir, "fixture/migration-terminal.ts")
const command = [process.execPath, fixture]

function profile(root: string, lang = "en_US.UTF-8") {
  const data = path.join(root, "data")
  const source = path.join(data, "kilo/kilo.db")
  mkdirSync(path.dirname(source), { recursive: true })
  const writer = path.join(root, "writer.db")
  using db = new Database(writer)
  db.exec("PRAGMA journal_mode = WAL; CREATE TABLE session (id INTEGER PRIMARY KEY); INSERT INTO session VALUES (1)")
  copyFileSync(writer, source)
  copyFileSync(`${writer}-wal`, `${source}-wal`)
  return {
    root,
    source,
    backup: `${source}.pre-v2`,
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(PATH|SystemRoot|WINDIR|PATHEXT)$/i.test(k))),
      HOME: root,
      USERPROFILE: root,
      KILO_V2_PROFILE: root,
      KILO_TERMINAL_TEST_PROFILE: root,
      KILO_TEST_HOME: root,
      OPENCODE_TEST_HOME: root,
      XDG_DATA_HOME: data,
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_STATE_HOME: path.join(root, "state"),
      TMPDIR: root,
      TEMP: root,
      TMP: root,
      TERM: "xterm-256color",
      LC_ALL: lang,
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    },
  }
}

async function interactive(p: ReturnType<typeof profile>, reply: string, args = command) {
  let text = ""
  let replied = false
  const decoder = new TextDecoder()
  const rendered = Promise.withResolvers<void>()
  const terminal = new Bun.Terminal({
    cols: 160,
    rows: 40,
    data(tty, bytes) {
      text += decoder.decode(bytes, { stream: true })
      if (/result: (true|false)/.test(Bun.stripANSI(text))) rendered.resolve()
      if (!replied && text.includes("[y/N]")) {
        replied = true
        tty.write(reply)
      }
    },
  })
  try {
    const child = Bun.spawn(args, {
      cwd: p.root,
      env: p.env,
      terminal,
      timeout: 10_000,
      ...(args === command && { ipc() {} }),
    })
    if (args === command && (await Promise.race([rendered.promise.then(() => true), child.exited.then(() => false)])))
      child.send("observed")
    const code = await child.exited
    return { code, text: Bun.stripANSI(text).replaceAll("\r", "") }
  } finally {
    terminal.close()
  }
}

test("a headless affirmative is refused with explicit migration commands", async () => {
  await using root = await tmpdir()
  const p = profile(root.path)
  const child = Bun.spawn(command, {
    cwd: p.root,
    env: p.env,
    stdin: new Blob(["yes\n"]),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(code, err).toBe(1)
  expect(out).toBe("")
  expect(err).toContain("kilo migrate preflight")
  expect(err).toContain("kilo migrate apply --accept-jetbrains-breakage")
  expect(existsSync(p.backup)).toBe(false)
})

// Only this mixed-stdio case requires a POSIX shell to pipe stdin inside the PTY.
test.skipIf(process.platform === "win32")(
  "piped stdin is not consent even with stdout and stderr on a TTY",
  async () => {
    await using root = await tmpdir()
    const p = profile(root.path)
    const result = await interactive(p, "", ["/bin/sh", "-c", `printf 'yes\\n' | "$@"`, "sh", ...command])
    expect(result.code, result.text).toBe(1)
    expect(result.text).toContain("--accept-jetbrains-breakage")
    expect(existsSync(p.backup)).toBe(false)
  },
)

for (const [key, reply] of [
  ["Enter", "\r"],
  ["typo", "yesterday\r"],
  ["Ctrl+D", "\x04"],
  ["Ctrl+C", "\x03"],
] as const) {
  // Bun.Terminal rejects the IPC side channel on Windows, and ConPTY does not implement POSIX control characters.
  test.skipIf(process.platform === "win32")(`${key} declines without invoking the migration`, async () => {
    await using root = await tmpdir()
    const p = profile(root.path)
    const result = await interactive(p, reply)
    expect(result.code, result.text).toBe(0)
    expect(result.text).toContain("Not now")
    expect(result.text).toContain("result: false")
    expect(result.text).not.toContain("Backing up")
    expect(existsSync(p.backup)).toBe(false)
  })
}

test.skipIf(process.platform === "win32")(
  "shows the full plan before accepting and reports phases and real row counts",
  async () => {
    await using root = await tmpdir()
    const p = profile(root.path)
    const size = statSync(p.source).size
    const wal = statSync(`${p.source}-wal`).size
    const result = await interactive(p, "yes\r")
    expect(result.code, result.text).toBe(0)
    // ConPTY can repaint the prompt while echoing the reply. Keep the whole transcript after its first occurrence.
    const prompt = result.text.indexOf("[y/N]")
    expect(prompt).toBeGreaterThanOrEqual(0)
    const plan = result.text.slice(0, prompt)
    const run = result.text.slice(prompt)
    expect(plan).toContain(`Source: ${p.source}`)
    expect(plan).toContain(`${(size + wal).toLocaleString("en-US")} bytes`)
    expect(plan).toContain(`WAL: ${wal.toLocaleString("en-US")} bytes`)
    expect(plan).toMatch(/Free space: [\d,]+ bytes/)
    expect(plan).toContain(`Proposed backup: ${p.backup}`)
    expect(plan).toContain("Close all Kilo v1 and preview clients")
    expect(plan).toContain("JetBrains cannot use this database")
    expect(run).toMatch(/Backing up[\s\S]*?Checking sessions 0\/1[\s\S]*?Checking sessions 1\/1[\s\S]*?result: true/)
    using copy = new Database(p.backup, { readonly: true })
    expect(copy.query("SELECT id FROM session").all()).toEqual([{ id: 1 }])
  },
)

test.skipIf(process.platform === "win32")(
  "renders the selected message locale, including Traditional Chinese",
  async () => {
    await using root = await tmpdir()
    const p = profile(root.path, "zh_TW.UTF-8")
    const result = await interactive(p, "n\r")
    expect(result.code, result.text).toBe(0)
    expect(result.text).toContain("暫不移轉")
    expect(result.text).toContain("JetBrains 專用 Kilo 外掛程式將無法使用此資料庫")
    expect(result.text).toContain("result: false")
  },
)
