import { expect, test } from "bun:test"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloConfigFiles } from "@opencode/util/kilocode/config/files"
import { hostMirrors, hostMirrorsPlugin } from "../src/mirrors"
import { projectConfigName } from "../src/tui-config-directories"
import { compileDefine } from "./fixtures/compile-define"

const entry = path.join(import.meta.dir, "fixtures/tui-discovery.ts")

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
          [".kilo2", ".opencode", ".kilo", ".kilocode"].flatMap((name) => {
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

      const outfile = path.join(tmp.path, process.platform === "win32" ? "discovery.exe" : "discovery")
      if (compiled) {
        const result = await Bun.build({
          entrypoints: [entry],
          plugins: hosted ? [hostMirrorsPlugin] : [],
          compile: { outfile, autoloadBunfig: false, autoloadDotenv: false },
          define: compileDefine,
        })
        expect(result.success, result.logs.map(String).join("\n")).toBe(true)
      }
      const child = Bun.spawn(compiled ? [outfile] : [process.execPath, entry], {
        cwd,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([key]) =>
              /^(PATH|LANG|LC_ALL|TZ|SystemRoot|WINDIR|PATHEXT)$/i.test(key),
            ),
          ),
          BUN_OPTIONS: "",
          HOME: tmp.path,
          USERPROFILE: tmp.path,
          TMPDIR: tmp.path,
          TEMP: tmp.path,
          TMP: tmp.path,
          KILO_DISCOVERY_TEST_HOSTED: hosted ? "1" : "0",
          KILO_DISCOVERY_TEST_CONFIG: config,
        },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 60_000,
      })
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect(code, stderr).toBe(0)

      const name = hosted ? ".kilo2" : ".opencode"
      const id = name.slice(1)
      expect(JSON.parse(stdout)).toEqual({
        themes: {
          global: { source: "global" },
          [`repo-${id}`]: { source: `repo-${id}` },
          [`package-${id}`]: { source: `package-${id}` },
        },
        directories: [
          path.join(config, "plugins"),
          path.join(project, name, "plugins"),
          path.join(cwd, name, "plugins"),
        ],
        plugins: [
          path.join(config, "plugins", "global"),
          path.join(project, name, "plugins", `repo-${id}`),
          path.join(cwd, name, "plugins", `package-${id}`),
        ],
      })
    }, 120_000)
  }
}

// Upstream lists the repository root's plugin directory before it exists, so the TUI's watcher picks it up when it
// appears. The mirror keeps that for `.kilo2`, and still skips a nested directory that does not exist.
test("the hosted plugin directories include a missing .kilo2 of the repository root", async () => {
  const hostedDiscovery = await import("../src/tui-plugin-discovery")
  const upstream = await import("../../tui/src/plugin/discovery")
  await using tmp = await temporary()
  const cwd = path.join(tmp.path, "repo", "package")
  await mkdir(cwd, { recursive: true })
  await mkdir(path.join(tmp.path, "repo", ".git"))
  const config = path.join(tmp.path, "config")
  expect(await hostedDiscovery.localPluginDirectories(cwd, config)).toEqual([
    path.join(config, "plugins"),
    path.join(tmp.path, "repo", ".kilo2", "plugins"),
  ])
  // The upstream module itself is unchanged: loaded without the host, it keeps its default.
  expect(await upstream.localPluginDirectories(cwd, config)).toEqual([
    path.join(config, "plugins"),
    path.join(tmp.path, "repo", ".opencode", "plugins"),
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

async function temporary() {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-tui-discovery-")))
  return { path: directory, [Symbol.asyncDispose]: () => rm(directory, { recursive: true, force: true }) }
}
