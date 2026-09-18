import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"

const source = resolve(import.meta.dir, "../../../..")
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

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
  cpSync(join(source, "packages/kilo-vscode/script/launch.ts"), join(root, "script/launch.ts"))
  await Bun.write(join(root, "package.json"), JSON.stringify({ scripts: { "build:launch": "bun build.ts" } }))
  await Bun.write(join(root, "build.ts"), 'await Bun.write("dist/extension.js", "built")')
  const workspace = join(repo, "workspace")
  await Bun.write(join(workspace, "package.json"), JSON.stringify({ main: "index.ts" }))
  await Bun.write(join(workspace, "index.ts"), 'await Bun.write("opened.json", JSON.stringify(process.argv.slice(2)))')
  return {
    root,
    workspace,
    run: (args: string[] = ["--no-build"]) =>
      Bun.spawnSync(
        [
          process.execPath,
          join(root, "script/launch.ts"),
          "--isolated",
          "--wait",
          "--app-path",
          process.execPath,
          "--workspace",
          workspace,
          ...args,
        ],
        {
          cwd: repo,
          env: { ...process.env, PATH: [dirname(process.execPath), process.env.PATH].join(delimiter) },
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
    expect(await Bun.file(join(item.workspace, "opened.json")).json()).toContain(
      `--extensionDevelopmentPath=${item.root}`,
    )
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
})
