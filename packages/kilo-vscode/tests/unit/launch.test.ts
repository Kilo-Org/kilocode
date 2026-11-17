import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { editorSpawn } from "../../script/editor-spawn"

const source = resolve(import.meta.dir, "../../../..")
const launcher = join(source, "packages/kilo-vscode/script/launch.ts")
const win = process.platform === "win32"
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// A detached launch exits before the editor writes anything, so poll for its output.
async function wait(path: string) {
  const end = Date.now() + 10000
  while (Date.now() < end) {
    const file = Bun.file(path)
    if (await file.exists()) return file
    await Bun.sleep(50)
  }
  throw new Error(`timed out waiting for ${path}`)
}

function fakeBin(dir: string, name: string, body: string) {
  mkdirSync(dir, { recursive: true })
  const target = join(dir, `${name}.js`)
  writeFileSync(target, body)
  writeFileSync(
    join(dir, win ? `${name}.cmd` : name),
    win ? `@echo off\r\n"${process.execPath}" "${target}" %*\r\n` : `#!${process.execPath}\n${body}`,
    { mode: 0o755 },
  )
}

const recordArgs = `
import { writeFileSync } from "node:fs"
writeFileSync(process.env.KILO_TEST_ARGV, JSON.stringify(process.argv.slice(2)))
if (process.env.KILO_TEST_FAIL_INSTALL === "1") process.exit(1)
`

const fakeVsce = `
import { writeFileSync } from "node:fs"
import { join } from "node:path"
const args = process.argv.slice(2)
const out = args[args.indexOf("-o") + 1]
writeFileSync(join(out, "test.vsix"), "vsix")
`

async function fixture() {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "kilo-launch-")))
  dirs.push(repo)
  for (const path of ["", "packages/kilo-vscode", "packages/opencode", "packages/sdk/js"]) {
    const dir = join(repo, path)
    mkdirSync(dir, { recursive: true })
    symlinkSync(join(source, path, "node_modules"), join(dir, "node_modules"), "junction")
  }
  const root = join(repo, "packages/kilo-vscode")
  mkdirSync(join(root, "script"))
  cpSync(launcher, join(root, "script/launch.ts"))
  cpSync(join(source, "packages/kilo-vscode/script/editor-spawn.ts"), join(root, "script/editor-spawn.ts"))
  await Bun.write(join(root, "package.json"), JSON.stringify({ scripts: { "build:launch": "bun build.ts" } }))
  await Bun.write(join(root, "build.ts"), 'await Bun.write("dist/extension.js", "built")')
  // A space in the workspace path is what broke the Windows launcher when it still
  // used `shell: true`, so every case below runs against such a path.
  const workspace = join(repo, "work space")
  await Bun.write(join(workspace, "package.json"), JSON.stringify({ main: "index.ts" }))
  await Bun.write(join(workspace, "index.ts"), 'await Bun.write("opened.json", JSON.stringify(process.argv.slice(1)))')
  // The fake VS Code CLI lives under a path with a space too, like
  // "C:\Program Files\Microsoft VS Code\bin\code.cmd" on Windows.
  const plainBin = join(repo, "bin")
  const spaceBin = join(repo, "code bin")
  fakeBin(plainBin, "bunx", fakeVsce)
  fakeBin(spaceBin, "code", recordArgs)
  const argvFile = join(repo, "argv.json")
  return {
    root,
    workspace,
    argvFile,
    run: (args: string[] = ["--no-build"], wait = true, extra: NodeJS.ProcessEnv = {}) =>
      Bun.spawnSync(
        [
          process.execPath,
          join(root, "script/launch.ts"),
          "--isolated",
          ...(wait ? ["--wait"] : []),
          "--app-path",
          process.execPath,
          "--workspace",
          workspace,
          ...args,
        ],
        {
          cwd: repo,
          env: {
            ...process.env,
            ...extra,
            KILO_TEST_ARGV: argvFile,
            PATH: [spaceBin, plainBin, dirname(process.execPath), process.env.PATH].join(delimiter),
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      ),
  }
}

describe("extension launch build", () => {
  test("builds a fresh worktree before launching even with --no-build", async () => {
    const item = await fixture()
    const result = item.run()
    expect(result.exitCode).toBe(0)
    expect(await Bun.file(join(item.root, "dist/extension.js")).text()).toBe("built")
    const argv: string[] = await Bun.file(join(item.workspace, "opened.json")).json()
    expect(argv).toContain(`--extensionDevelopmentPath=${item.root}`)
    // A shell would split this argument on the space, including on POSIX CI runners.
    expect(argv[0]).toContain(item.workspace)
  })

  test("reuses an existing bundle with --no-build", async () => {
    const item = await fixture()
    await Bun.write(join(item.root, "dist/extension.js"), "previous")
    expect(item.run().exitCode).toBe(0)
    expect(await Bun.file(join(item.root, "dist/extension.js")).text()).toBe("previous")
    expect(await Bun.file(join(item.workspace, "opened.json")).exists()).toBe(true)
  })

  test("rebuilds an existing bundle by default", async () => {
    const item = await fixture()
    await Bun.write(join(item.root, "dist/extension.js"), "previous")
    expect(item.run([]).exitCode).toBe(0)
    expect(await Bun.file(join(item.root, "dist/extension.js")).text()).toBe("built")
  })

  test("does not launch when the required build fails", async () => {
    const item = await fixture()
    await Bun.write(join(item.root, "build.ts"), "process.exit(1)")
    expect(item.run().exitCode).toBe(1)
    expect(await Bun.file(join(item.workspace, "opened.json")).exists()).toBe(false)
  })

  test("launches detached without --wait from a path containing a space", async () => {
    const item = await fixture()
    expect(item.run(["--no-build"], false).exitCode).toBe(0)
    const opened = await wait(join(item.workspace, "opened.json"))
    const argv: string[] = await opened.json()
    expect(argv).toContain(`--extensionDevelopmentPath=${item.root}`)
    expect(argv[0]).toContain(item.workspace)
  }, 15000)

  test("keeps the detached launch shell-free on every platform", async () => {
    const app = join(tmpdir(), "Microsoft VS Code", "Code.exe")
    const workspace = join(tmpdir(), "work space")
    const editor = editorSpawn(app, [workspace, `--extensionDevelopmentPath=${app}`], workspace, {})
    expect(editor.command).toBe(app)
    expect(editor.args).toEqual([workspace, `--extensionDevelopmentPath=${app}`])
    expect("shell" in editor.options).toBe(false)
    expect(editor.options.detached).toBe(true)
    expect(editor.options.cwd).toBe(workspace)

    const text = await Bun.file(launcher).text()
    expect(text).toContain("editorSpawn(")
    expect(text).not.toContain("shell: true")
  })

  test("installs a VSIX through a CLI path containing a space", async () => {
    const item = await fixture()
    const result = item.run(["--no-build", "--mode", "vsix"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toContain("Installed VSIX")
    const argv: string[] = await Bun.file(item.argvFile).json()
    expect(argv).toContain("--install-extension")
    expect(argv).toContain("--force")
    expect(argv.some((arg) => arg.startsWith("--extensions-dir="))).toBe(true)
    expect(argv.some((arg) => arg.endsWith(".vsix"))).toBe(true)
  })

  test("reports a failed VSIX install", async () => {
    const item = await fixture()
    const result = item.run(["--no-build", "--mode", "vsix"], true, { KILO_TEST_FAIL_INSTALL: "1" })
    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain("Failed to install VSIX")
  })
})
