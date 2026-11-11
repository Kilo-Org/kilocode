import { expect, test } from "bun:test"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { hostMirrors } from "../src/mirrors"
import { projectConfigName } from "../src/tui-config-directories"
import { localPluginDirectories } from "../src/tui-plugin-discovery"

const entry = path.join(import.meta.dir, "fixtures/tui-discovery.ts")
const build = path.join(import.meta.dir, "fixtures/tui-discovery-build.ts")
const names = [".kilo2", ".opencode", ".kilo", ".kilocode"]

// The TUI reads custom themes (`<dir>/themes`) and local plugins (`<dir>/plugins`) from project directories. Without
// the host they are upstream's `.opencode`; under the host they are `.kilo2`, with no fallback to `.opencode`. The
// project below has both in the repository root and in a nested package, and the discovery runs from the package.
for (const compiled of [false, true]) {
  for (const hosted of [false, true]) {
    test(`${compiled ? "compiled" : "source"} ${hosted ? "hosted" : "unhosted"} theme and plugin directories`, async () => {
      await using tmp = await temporary()
      const project = path.join(tmp.path, "repo")
      const cwd = path.join(project, "package")
      const config = path.join(tmp.path, "config")
      await mkdir(path.join(project, ".git"), { recursive: true })
      await Promise.all(
        [project, cwd].flatMap((directory) =>
          names.flatMap((name) => {
            const id = `${path.basename(directory)}-${name.slice(1)}`
            return [
              Bun.write(path.join(directory, name, "themes", `${id}.json`), JSON.stringify({ source: id })),
              Bun.write(path.join(directory, name, "plugins", id, "tui.ts"), "export default {}\n"),
            ]
          }),
        ),
      )
      await Bun.write(path.join(config, "themes", "global.json"), JSON.stringify({ source: "global" }))
      await Bun.write(path.join(config, "plugins", "global", "tui.ts"), "export default {}\n")

      const env = {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => /^(PATH|LANG|LC_ALL|TZ|SystemRoot|WINDIR|PATHEXT)$/i.test(key)),
        ),
        BUN_OPTIONS: "",
        HOME: tmp.path,
        USERPROFILE: tmp.path,
        TMPDIR: tmp.path,
        TEMP: tmp.path,
        TMP: tmp.path,
        KILO_DISCOVERY_TEST_HOSTED: hosted ? "1" : "0",
        KILO_DISCOVERY_TEST_CONFIG: config,
      }
      const outfile = path.join(tmp.path, process.platform === "win32" ? "discovery.exe" : "discovery")
      // A compile leaves a copy of the Bun runtime (`.<id>.bun-build`, about 90 MB) in the working directory of the
      // process that builds. The build runs in a child process in its own temporary directory, which is removed
      // with the test's files; the package directory is shared with test files that build at the same time. That
      // directory must not be the child's TMPDIR (`tmp.path`): Bun then fails with "EEXIST ... .bun-build".
      if (compiled) {
        await mkdir(path.join(tmp.path, "build"))
        await run([process.execPath, build, outfile, hosted ? "hosted" : "unhosted"], path.join(tmp.path, "build"), env)
      }
      const result = JSON.parse(await run(compiled ? [outfile] : [process.execPath, entry], cwd, env)) as {
        themes: Record<string, unknown>
        directories: string[]
        plugins: string[]
      }

      // Themes are read from every ancestor up to the filesystem root, so a directory above the temporary one can add
      // themes of its own. Only the themes of this project are compared.
      const used = hosted ? ".kilo2" : ".opencode"
      expect(result.themes.global).toEqual({ source: "global" })
      for (const directory of ["repo", "package"]) {
        for (const name of names) {
          const id = `${directory}-${name.slice(1)}`
          expect(result.themes[id], id).toEqual(name === used ? { source: id } : undefined)
        }
      }
      // Plugin directories stop at the repository root (the `.git` above), so the lists are exact.
      const id = used.slice(1)
      expect(result.directories).toEqual([
        path.join(config, "plugins"),
        path.join(project, used, "plugins"),
        path.join(cwd, used, "plugins"),
      ])
      expect(result.plugins).toEqual([
        path.join(config, "plugins", "global"),
        path.join(project, used, "plugins", `repo-${id}`),
        path.join(cwd, used, "plugins", `package-${id}`),
      ])
    }, 120_000)
  }
}

// Upstream lists the repository root's plugin directory before it exists, so the TUI's watcher picks it up when it
// appears. The mirror keeps that for `.kilo2`, and still skips a nested directory that does not exist.
test("the hosted plugin directories include a missing .kilo2 of the repository root", async () => {
  await using tmp = await temporary()
  const cwd = path.join(tmp.path, "repo", "package")
  await mkdir(cwd, { recursive: true })
  await mkdir(path.join(tmp.path, "repo", ".git"))
  const config = path.join(tmp.path, "config")
  expect(await localPluginDirectories(cwd, config)).toEqual([
    path.join(config, "plugins"),
    path.join(tmp.path, "repo", ".kilo2", "plugins"),
  ])
})

test("the hosted project directory is the one of Kilo's config discovery", () => {
  expect(projectConfigName).toBe(".kilo2")
  expect(KiloConfigFiles.directories).toEqual([projectConfigName])
})

test("every host mirror names an upstream file and a Kilo file", async () => {
  for (const [upstream, mirror] of Object.entries(hostMirrors)) {
    expect(await Bun.file(path.join(import.meta.dir, "../..", upstream)).exists(), upstream).toBe(true)
    expect(await Bun.file(path.join(import.meta.dir, "../src", mirror)).exists(), mirror).toBe(true)
  }
})

test("the config directories mirror differs from upstream only in the project directory name", async () => {
  const stat = 'import { stat } from "node:fs/promises"\n'
  const upstream = replace(
    await source("../../tui/src/util/config-directories.ts"),
    stat,
    stat +
      'import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"\n\n' +
      "// Kilo: the project config directory, the one that config discovery reads (core/src/kilocode/config/discovery.ts).\n" +
      "export const projectConfigName = KiloConfigFiles.directories[0]\n",
  )
  expect(upstream.split('path.join(directory, ".opencode")')).toHaveLength(3)
  expect(body(await source("../src/tui-config-directories.ts"))).toBe(
    upstream.replaceAll('path.join(directory, ".opencode")', "path.join(directory, projectConfigName)"),
  )
})

test("the plugin discovery mirror differs from upstream only in the project directory name", async () => {
  const upstream = replace(
    replace(
      await source("../../tui/src/plugin/discovery.ts"),
      'import { isMissingPath, localProjectDirectory, projectConfigDirectories } from "../util/config-directories"\n',
      "// Kilo: the mirror of the directory helpers, with Kilo's project config directory name.\n" +
        "import {\n  isMissingPath,\n  localProjectDirectory,\n  projectConfigDirectories,\n  projectConfigName,\n" +
        '} from "./tui-config-directories"\n',
    ),
    'path.join(projectDirectory, ".opencode")',
    "path.join(projectDirectory, projectConfigName)",
  )
  expect(body(await source("../src/tui-plugin-discovery.ts"))).toBe(upstream)
})

async function source(file: string) {
  return (await Bun.file(path.join(import.meta.dir, file)).text()).replaceAll("\r\n", "\n")
}

// A mirror without its leading comment block.
function body(mirror: string) {
  return mirror.replace(/^(?:\/\/.*\n)+/, "")
}

function replace(text: string, from: string, to: string) {
  expect(text.split(from), from).toHaveLength(2)
  return text.replace(from, to)
}

async function run(command: string[], cwd: string, env: Record<string, string | undefined>) {
  const child = Bun.spawn(command, { cwd, env, stdout: "pipe", stderr: "pipe", timeout: 60_000 })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect(code, stderr).toBe(0)
  return stdout
}

async function temporary() {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-tui-discovery-")))
  return { path: directory, [Symbol.asyncDispose]: () => rm(directory, { recursive: true, force: true }) }
}
