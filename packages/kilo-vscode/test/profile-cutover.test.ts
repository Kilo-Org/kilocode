import { Database } from "bun:sqlite"
import { afterEach, expect, spyOn, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { prepareProfile, verifyProfile } from "../src/profile-cutover"
import { profileCutover } from "../src/profile-cutover-ui"
import { useProfile } from "../src/active-profile"
import { configTargets } from "../src/config-targets"
import { globalSpeechConfigFiles } from "../src/speech-to-text/config"
import { resolveStateDir } from "../src/settings-paths"
import { translate } from "../src/services/i18n"
import { manager, serverPlans } from "../src/server"
import { window } from "vscode"

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((dir) => rmSync(dir, { force: true, recursive: true })))

function fixture(status: string, extras: Record<string, unknown> = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "kilo-vscode-cutover-"))
  roots.push(cwd)
  const home = path.join(cwd, "home")
  mkdirSync(home)
  const source = path.join(cwd, "data", "kilo", "kilo.db")
  mkdirSync(path.dirname(source), { recursive: true })
  using db = new Database(source)
  db.run("CREATE TABLE fixture (id INTEGER PRIMARY KEY)")
  db.run("INSERT INTO fixture VALUES (1)")
  const detail = {
    source,
    sourceBytes: statSync(source).size,
    walBytes: 0,
    availableBytes: 987654321,
    backup: `${source}.pre-v2`,
  }
  const cli = path.join(cwd, "cli.js")
  const profile = {
    source,
    config: path.join(cwd, "custom config"),
    data: path.dirname(source),
    state: path.join(cwd, "state/kilo"),
  }
  // The mock owns only stdin/stdout protocol edge cases. It can't reach an installed binary or server.
  writeFileSync(
    cli,
    `
    const fs = require('node:fs');
    const args = process.argv.slice(2);
    fs.appendFileSync('invoked', args.join(' ') + '\\n');
    if (process.env.KILO_CLIENT !== 'vscode' || process.env.INIT_CWD !== process.env.KILO_V2_PROFILE ||
        process.env.KILOCODE_EDITOR_NAME !== 'test editor' || process.env.OPENCODE_PASSWORD) process.exit(29);
    if (args[1] === 'preflight') {
      const plan = JSON.parse(process.env.PREFLIGHT);
      if (fs.existsSync('completed')) plan.status = 'completed';
      console.log(JSON.stringify(plan));
      process.exit(Number(process.env.PROBE_EXIT || 0));
    }
    console.error('fixture stderr');
    process.stdout.write('{"phase":"back');
    await Bun.sleep(10);
    process.stdout.write('up","done":1,"total":2}\\r\\n{"phase":"verified"}');
    if (process.env.INVALID) process.stdout.write('\\nnot json');
    if (!process.env.APPLY_EXIT && !process.env.NO_COMPLETION) fs.writeFileSync('completed', '');
    process.exitCode = Number(process.env.APPLY_EXIT || 0);
  `,
  )
  const log: string[] = []
  const input = {
    cwd,
    command: { cmd: process.execPath, args: [cli, "serve", "--stdio"], env: { KILO_V2_PROFILE: cwd } },
    env: {
      HOME: home,
      USERPROFILE: home,
      KILO_TEST_HOME: home,
      OPENCODE_TEST_HOME: home,
      XDG_DATA_HOME: path.join(cwd, "data"),
      XDG_CONFIG_HOME: path.join(cwd, "config"),
      XDG_CACHE_HOME: path.join(cwd, "cache"),
      XDG_STATE_HOME: path.join(cwd, "state"),
      OPENCODE_PASSWORD: "synthetic-old-password",
      PREFLIGHT: JSON.stringify({
        version: 1,
        status,
        ...detail,
        legacyConfig: profile.config,
        legacyData: profile.data,
        legacyState: profile.state,
        ...extras,
      }),
    } as NodeJS.ProcessEnv,
    settings: { KILOCODE_EDITOR_NAME: "test editor" },
    log: (text: string) => {
      log.push(text)
    },
  }
  return {
    input,
    log,
    detail,
    profile,
    calls: () => readFileSync(path.join(cwd, "invoked"), "utf8").trim().split("\n"),
  }
}

const never = (): never => {
  throw new Error("Unexpected prompt or progress")
}
const silent = { confirm: never, progress: never }

test("native gate always presents the localized inventory before any apply", async () => {
  const { input, calls, detail } = fixture("required")
  const out = window.createOutputChannel("fixture")
  using warning = spyOn(window, "showWarningMessage").mockResolvedValue(undefined)
  using info = spyOn(window, "showInformationMessage").mockResolvedValue(undefined)
  const gate = profileCutover(input.cwd, out, input.env)!
  expect(await gate.activate(input.command, input.settings)).toBe(false)
  expect(warning).toHaveBeenCalledWith(
    translate("en", "migration.title"),
    {
      modal: true,
      detail: expect.stringContaining(detail.backup),
    },
    { title: "Back up and migrate", accepted: true },
    { title: "Not now", isCloseAffordance: true },
  )
  expect(warning.mock.calls[0][1]).toMatchObject({ detail: expect.stringContaining("JetBrains") })
  expect(info).toHaveBeenCalledWith("Kilo did not start. Reload the window to try again.")
  expect(calls()).toEqual(["migrate preflight"])
  expect(translate("de", "migration.accept")).not.toBe("Back up and migrate")
  expect(translate("de", "migration.summary", { source: "$&{{backup}}", backup: "s" })).toContain("$&{{backup}}")
})

test("the selected dev CLI probes only the synthetic profile; declining a WAL store is read-only", async () => {
  const { input, detail } = fixture("required")
  input.command.args = [path.resolve(import.meta.dir, "../../../script/dev-isolated.ts"), "serve", "--stdio"]
  using db = new Database(detail.source)
  db.exec(readFileSync(path.join(import.meta.dir, "../../kilo-cli/test/fixture/kilo-v1-schema.sql"), "utf8"))
  db.run("PRAGMA journal_mode = WAL")
  db.run("INSERT INTO fixture VALUES (2)")
  const inventory = () =>
    readdirSync(path.dirname(detail.source)).map((name) => [
      name,
      readFileSync(path.join(path.dirname(detail.source), name)),
    ])
  const before = inventory()
  const confirm: Parameters<typeof prepareProfile>[1]["confirm"] = async (value) => {
    expect(value.source).toBe(detail.source)
    expect(value.sourceBytes).toBe(statSync(detail.source).size)
    expect(value.walBytes).toBeGreaterThan(0)
    expect(value.availableBytes).toBeGreaterThan(0)
    expect(value.backup).not.toBe(detail.source)
    return false
  }
  expect(await prepareProfile(input, { confirm, progress: never })).toBe(false)
  expect(inventory()).toEqual(before)
}, 30000)

test.each(["absent", "native", "completed"])("%s needs no prompt or migration process", async (status) => {
  const { input, calls, profile } = fixture(status)
  expect(await prepareProfile(input, silent)).toEqual({
    profile: status === "absent" ? { ...profile, fresh: true } : profile,
  })
  expect(calls()).toEqual(["migrate preflight"])
})

test.each(["failed", "blocked", "interrupted", "unknown"])("%s can't fall through to the server", async (status) => {
  const { input, calls } = fixture(status, { message: "fixture reason" })
  await expect(prepareProfile(input, silent)).rejects.toThrow("fixture reason")
  expect(calls()).toEqual(["migrate preflight"])
})

test("no consent can be inferred from a now-stale running observation", async () => {
  const { input, calls, detail } = fixture("running")
  const declined = await prepareProfile(input, {
    confirm: async (preview) => {
      expect(preview).toEqual(detail)
      return false
    },
    progress: never,
  })
  expect(declined).toBe(false)
  expect(calls()).toEqual(["migrate preflight"])
})

test.each([
  ["required", false, "apply --accept-jetbrains-breakage"],
  ["running", false, "apply --accept-jetbrains-breakage"],
  ["running", true, "observe"],
] as const)("streams %s (observer %p) via %s", async (status, canObserve, args) => {
  const { input, log, calls, profile } = fixture(status, { canObserve })
  const reports: unknown[] = []
  const result = await prepareProfile(input, {
    confirm: canObserve ? never : async () => true,
    progress: (run) => run((event) => reports.push(event)),
  })
  expect(result).toEqual({ profile })
  expect(calls()).toEqual(["migrate preflight", `migrate ${args}`, "migrate preflight"])
  expect(reports).toEqual([{ phase: "backup", done: 1, total: 2 }, { phase: "verified" }])
  expect(log.join("")).toContain("exit 0")
})

test.each(["observe", "apply"])("%s waits for actual child failure after the last progress event", async (action) => {
  const { input, calls } = fixture("running", { canObserve: action === "observe" })
  input.env.APPLY_EXIT = "19"
  await expect(prepareProfile(input, { confirm: async () => true, progress: (run) => run(() => {}) })).rejects.toThrow(
    "exit 19: fixture stderr",
  )
  expect(calls()).toHaveLength(2)
})

test("newer protocol, failed probe, malformed inventory and malformed progress all fail closed", async () => {
  const { input } = fixture("required", { version: 2 })
  await expect(prepareProfile(input, silent)).rejects.toThrow("version")
  input.env.PROBE_EXIT = "23"
  input.env.PREFLIGHT = '{"version":1,"status":"absent"}'
  await expect(prepareProfile(input, silent)).rejects.toThrow()
  delete input.env.PROBE_EXIT
  input.env.PREFLIGHT = '{"version":1,"status":"required"}'
  await expect(prepareProfile(input, silent)).rejects.toThrow("paths")
  const invalid = fixture("required")
  invalid.input.env.INVALID = "1"
  await expect(
    prepareProfile(invalid.input, { confirm: async () => true, progress: (run) => run(() => {}) }),
  ).rejects.toThrow()
})

test("a failed start-time recheck never spawns serve, including on restart", async () => {
  const { input, calls } = fixture("failed")
  const server = manager({
    ...input,
    command: () => input.command,
    beforeStart: async (command, settings) => {
      await verifyProfile({ ...input, command, settings })
    },
  })
  await expect(server.get()).rejects.toThrow("failed")
  await server.stop()
  await expect(server.get()).rejects.toThrow("failed")
  expect(calls()).toEqual(["migrate preflight", "migrate preflight"])
})

test("native paths switch only after completed preflight; changes to the active profile block a restart", async () => {
  const { input, profile } = fixture("completed")
  const gate = profileCutover(input.cwd, window.createOutputChannel("fixture"), input.env)!
  try {
    expect(await gate.activate(input.command, input.settings)).toBe(true)
    expect(globalSpeechConfigFiles(input.env, "preview")).toEqual(
      ["kilo.json", "kilo.jsonc"].map((file) => path.join(profile.config, file)),
    )
    expect(serverPlans(input.command, input.env)).toBe(path.join(profile.data, "plans"))
    expect(resolveStateDir(input.env, "preview")).toBe(profile.state)
    expect(
      path.basename((await configTargets({ entries: [], directory: input.cwd, profile: "preview" })).project),
    ).toBe("kilo.json")
    await gate.beforeStart(input.command, input.settings)
    input.env.PREFLIGHT = JSON.stringify({ ...JSON.parse(input.env.PREFLIGHT!), legacyConfig: input.cwd })
    await expect(gate.beforeStart(input.command, input.settings)).rejects.toThrow("changed")
  } finally {
    useProfile(undefined)
  }
})

test("missing completion after exit zero does not permit activation", async () => {
  const { input } = fixture("running", { canObserve: true })
  input.env.NO_COMPLETION = "1"
  await expect(prepareProfile(input, { confirm: never, progress: (run) => run(() => {}) })).rejects.toThrow("running")
})

test("a known native database disappearing is not a new installation", async () => {
  const { input, profile } = fixture("absent")
  await expect(verifyProfile(input, profile)).rejects.toThrow("profile changed")
  expect((await verifyProfile(input, { ...profile, fresh: true })).fresh).toBe(true)
})
