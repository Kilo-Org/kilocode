import assert from "node:assert/strict"
import { cp, mkdir, mkdtemp, readFile, readdir, lstat, realpath, writeFile, rm } from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { sanitize } from "./response-lens-real-host-server.mjs"

export const fixture = fileURLToPath(new URL("./fixtures/response-lens-real-host/", import.meta.url))
export const defaults = {
  executable: "C:\\Users\\akale\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
  baseline: "C:\\Users\\akale\\.vscode\\extensions\\kilocode.kilo-code-7.5.16-win32-x64",
  codex: "C:\\Users\\akale\\.vscode\\extensions\\openai.chatgpt-26.901.22334-win32-x64",
}

export function inside(root, value) {
  const relative = path.relative(root, value)
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
}

export async function manifest(source) {
  const dir = await realpath(source)
  const pkg = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"))
  assert.ok(inside(dir, path.resolve(dir, pkg.main)), "Package main must be contained")
  await lstat(path.join(dir, pkg.main))
  if (pkg.publisher !== "local-test") await lstat(path.join(dir, ".vsixmanifest"))
  return { dir, pkg }
}

export async function fingerprint(source) {
  const { dir, pkg } = await manifest(source)
  const files = ["package.json", pkg.main]
  if (pkg.publisher === "kilocode") files.push("dist/webview.js", "dist/agent-manager.js", "bin/kilo.exe")
  const hashes = {}
  for (const name of files)
    hashes[name] = createHash("sha256")
      .update(await readFile(path.join(dir, name)))
      .digest("hex")
  return { id: `${pkg.publisher}.${pkg.name}`, version: pkg.version, source: dir, hashes }
}

export async function prepare(label, server, opts) {
  const runs = path.join(fixture, "runs")
  await mkdir(runs, { recursive: true })
  const root = await mkdtemp(path.join(runs, `${label}-`))
  const state = path.join(root, "state")
  const dirs = Object.fromEntries(
    [
      "home",
      "user-data",
      "extensions",
      "config",
      "data",
      "cache",
      "state",
      "appdata",
      "localappdata",
      "codex",
      "temp",
      "workspace",
      "programdata",
    ].map((name) => [name, path.join(state, name)]),
  )
  for (const dir of Object.values(dirs)) await mkdir(dir, { recursive: true })
  await mkdir(path.join(dirs["user-data"], "User"), { recursive: true })
  const settings = {
    "telemetry.telemetryLevel": "off",
    "update.mode": "none",
    "extensions.autoUpdate": false,
    "extensions.autoCheckUpdates": false,
    "extensions.ignoreRecommendations": true,
    "settingsSync.enabled": false,
    "security.workspace.trust.enabled": false,
    "task.allowAutomaticTasks": "off",
    "workbench.startupEditor": "none",
    "workbench.tips.enabled": false,
    "workbench.enableExperiments": false,
    "chat.disableAIFeatures": true,
    "http.proxy": server.url,
    "http.proxySupport": "override",
    "http.noProxy": ["127.0.0.1", "localhost", "::1"],
    "git.autofetch": false,
    "git.enabled": false,
    "kilo-code.new.claudeCodeCompat": false,
    "kilo-code.new.autocomplete.enabled": false,
    "chatgpt.openOnStartup": false,
    "chatgpt.runCodexInWindowsSubsystemForLinux": false,
  }
  await writeFile(path.join(dirs["user-data"], "User", "settings.json"), JSON.stringify(settings, null, 2))
  const config = {
    model: "fixture/fixture-model",
    small_model: "fixture/fixture-model",
    enabled_providers: ["fixture"],
    disabled_providers: ["kilo", "openai", "anthropic"],
    provider: {
      fixture: {
        npm: "@ai-sdk/openai-compatible",
        name: "Real Host Fixture",
        options: { baseURL: `${server.url}/v1`, apiKey: "fixture-dummy-key" },
        models: {
          "fixture-model": {
            name: "Fixture Model",
            limit: { context: 1000000, output: 20000 },
            cost: { input: 0, output: 0 },
          },
        },
      },
    },
    mcp: {},
    plugin: [],
    skills: { paths: [], urls: [] },
    permission: "deny",
    autoupdate: false,
    snapshot: false,
    share: "disabled",
    compaction: { auto: false, prune: false },
  }
  const configfile = path.join(dirs.config, "kilo.json")
  await writeFile(configfile, JSON.stringify(config, null, 2))
  // Documented Codex file-only storage never falls back to the OS keyring.
  await writeFile(
    path.join(dirs.codex, "config.toml"),
    'cli_auth_credentials_store = "file"\ncheck_for_update_on_startup = false\n[analytics]\nenabled = false\n[otel]\nexporter = "none"\nmetrics_exporter = "none"\n',
  )
  const env = {
    SystemRoot: process.env.SystemRoot || "C:\\Windows",
    WINDIR: process.env.WINDIR || "C:\\Windows",
    ComSpec: path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe"),
    PATH: [
      path.dirname(opts.executable),
      path.dirname(process.execPath),
      "C:\\Windows\\System32",
      "C:\\Windows",
      "C:\\Program Files\\Git\\cmd",
    ].join(path.delimiter),
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    USERNAME: "response-lens-fixture",
    HOME: dirs.home,
    USERPROFILE: dirs.home,
    HOMEDRIVE: path.parse(dirs.home).root.slice(0, -1),
    HOMEPATH: dirs.home.slice(path.parse(dirs.home).root.length - 1),
    APPDATA: dirs.appdata,
    LOCALAPPDATA: dirs.localappdata,
    ProgramData: dirs.programdata,
    TEMP: dirs.temp,
    TMP: dirs.temp,
    CODEX_HOME: dirs.codex,
    XDG_CONFIG_HOME: dirs.config,
    XDG_DATA_HOME: dirs.data,
    XDG_CACHE_HOME: dirs.cache,
    XDG_STATE_HOME: dirs.state,
    KILO_TEST_HOME: dirs.home,
    KILO_CONFIG: configfile,
    KILO_CONFIG_DIR: dirs.config,
    KILO_CONFIG_CONTENT: JSON.stringify(config),
    KILO_DISABLE_PROJECT_CONFIG: "true",
    KILO_DISABLE_AUTOUPDATE: "true",
    KILO_DISABLE_MODELS_FETCH: "true",
    KILO_DISABLE_DEFAULT_PLUGINS: "true",
    KILO_DISABLE_CLAUDE_CODE: "true",
    KILO_DISABLE_EXTERNAL_SKILLS: "true",
    KILO_DISABLE_LSP_DOWNLOAD: "true",
    KILO_DISABLE_CODEBASE_INDEXING: "real-host-fixture",
    KILO_DISABLE_AUTOCOMPACT: "true",
    KILO_TELEMETRY_LEVEL: "off",
    KILO_API_URL: server.url,
    KILO_CHAT_URL: server.url,
    KILO_SESSION_INGEST_URL: server.url,
    EVENT_SERVICE_URL: server.url,
    HTTP_PROXY: server.url,
    HTTPS_PROXY: server.url,
    ALL_PROXY: server.url,
    NO_PROXY: "127.0.0.1,localhost,::1",
    DO_NOT_TRACK: "1",
    OTEL_SDK_DISABLED: "true",
    npm_config_cache: path.join(dirs.cache, "npm"),
    BUN_INSTALL_CACHE_DIR: path.join(dirs.cache, "bun"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CEILING_DIRECTORIES: state,
    GIT_CONFIG_GLOBAL: path.join(dirs.home, "empty.gitconfig"),
    RL_REAL_ROOT: root,
    RL_CONTROL_URL: server.url,
    RL_RUN_CAP: server.cap,
  }
  const args = [
    dirs.workspace,
    `--user-data-dir=${dirs["user-data"]}`,
    `--extensions-dir=${dirs.extensions}`,
    "--new-window",
    "--skip-welcome",
    "--skip-release-notes",
    "--disable-updates",
    "--disable-telemetry",
    "--disable-workspace-trust",
    "--disable-settings-sync",
    "--password-store=basic",
    "--use-mock-keychain",
    "--disable-crash-reporter",
    `--proxy-server=${server.url}`,
    "--proxy-bypass-list=localhost;127.0.0.1;[::1]",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
  ]
  await cp(
    path.join(fixture, "helper"),
    path.join(dirs.extensions, "local-test.response-lens-real-host-helper-0.0.1"),
    { recursive: true, errorOnExist: true, force: false },
  )
  return { root, state, dirs, env, args, config }
}

export async function copyPackage(source, run, requireModule) {
  const stat = await lstat(source)
  if (stat.isFile()) {
    assert.equal(path.extname(source).toLowerCase(), ".vsix", "Candidate must be a packaged directory or VSIX")
    const { unzipSync } = requireModule("fflate")
    const archive = await readFile(source)
    const files = unzipSync(archive)
    const target = path.join(run.dirs.extensions, "candidate-package")
    let bytes = 0
    for (const [name, data] of Object.entries(files)) {
      if (!name.startsWith("extension/")) continue
      const dest = path.resolve(target, name.slice("extension/".length))
      assert.ok(dest === target || inside(target, dest), "Unsafe VSIX member")
      bytes += data.length
      assert.ok(bytes <= 2 * 1024 ** 3, "VSIX exceeds unpacked size budget")
      if (name.endsWith("/")) {
        await mkdir(dest, { recursive: true })
        continue
      }
      await mkdir(path.dirname(dest), { recursive: true })
      await writeFile(dest, data)
    }
    await writeFile(path.join(target, ".vsixmanifest"), files["extension.vsixmanifest"])
    return {
      ...(await fingerprint(target)),
      archive: { path: await realpath(source), sha256: createHash("sha256").update(archive).digest("hex") },
    }
  }
  const before = await fingerprint(source)
  const target = path.join(run.dirs.extensions, `${before.id}-${before.version}`)
  assert.ok(!inside(source, target), "Destination cannot be inside source")
  await cp(source, target, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: async (file) => {
      assert.ok(!(await lstat(file)).isSymbolicLink(), `Package symlink refused: ${path.basename(file)}`)
      return true
    },
  })
  const after = await fingerprint(target)
  assert.deepEqual(after.hashes, before.hashes, "Copied packaged bytes differ")
  return { ...before, copy: target }
}

export async function collect(run) {
  const output = path.join(run.root, "logs")
  await mkdir(output, { recursive: true })
  const visit = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await visit(file)
        continue
      }
      if (!/\.(log|txt)$/.test(entry.name)) continue
      if ((await lstat(file)).size > 16 * 1024 * 1024) continue
      const target = path.join(output, path.relative(run.state, file).replace(/[\\/]/g, "__"))
      await writeFile(target, sanitize(await readFile(file, "utf8")))
    }
  }
  for (const dir of [path.join(run.dirs["user-data"], "logs"), run.dirs.data, run.dirs.codex]) {
    try {
      await visit(dir)
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
  }
}

export async function cleanup(run) {
  assert.ok(inside(path.join(fixture, "runs"), run.root) && run.state === path.join(run.root, "state"))
  await rm(run.state, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
}
