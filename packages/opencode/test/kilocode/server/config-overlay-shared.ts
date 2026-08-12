// kilocode_change start - shared setup for the config-overlay test files.
// config-overlay.test.ts used to hold all 34 of these tests in a single file. The CLI
// test runner spawns one process per *file*, so those 34 tests ran strictly serially and
// pinned the whole Linux unit matrix at ~180s — a floor no amount of sharding could break.
// The tests are split across config-overlay-{scope,instances,effective,sandbox}.test.ts,
// grouped so each file lands near ~45s of measured work, and share this module.
import { afterEach, setDefaultTimeout, test } from "bun:test"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { Global } from "@opencode-ai/core/global"
import { Server } from "../../../src/server/server"
import { Config } from "../../../src/config/config"
import { Permission } from "../../../src/permission"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances } from "../../fixture/fixture"

void Log.init({ print: false })

const original = Global.Path.config

// Terminal-backed assertions need a real PTY, which Windows CI cannot provide.
export const terminal = process.platform === "win32" ? test.skip : test.serial

export type Target = {
  path: string
  revision: string
  exists: boolean
  writable: boolean
  raw: Record<string, unknown>
}
export type Overlay = {
  fields: Record<string, { source: string; inherited: boolean; overridden: boolean; value?: unknown }>
  collections: Record<string, Array<{ key: string; source: string; inherited: boolean; local?: unknown }>>
  targets: { project: Target; global: Target; active: Target }
  effective?: Config.Info
}
export type Agent = {
  name: string
  permission: Permission.Ruleset
}

// Registers the per-file timeout and teardown. Every config-overlay test file calls this at
// module scope so each spawned process gets the same isolation the single file used to have.
export function setup() {
  // Cold Windows CI runs with parallel shards take ~32s across multiple temp repo instance cycles
  setDefaultTimeout(90_000)

  afterEach(async () => {
    ;(Global.Path as { config: string }).config = original
    await disposeAllInstances()
    await resetDatabase()
  }, 15_000)
}

export function req(dir: string, input: string, init?: RequestInit) {
  return request(Server.Default().app, dir, input, init)
}

export function app(_value: boolean) {
  return Server.Default().app
}

export async function request(
  target: ReturnType<typeof app>,
  dir: string | undefined,
  input: string,
  init?: RequestInit,
) {
  const headers = {
    ...(dir ? { "x-kilo-directory": dir } : {}),
    ...init?.headers,
  }
  const body = init?.method === "PATCH" && input === "/config/overlay" ? JSON.parse(String(init.body)) : undefined
  const next =
    body && !body.expected
      ? await (async () => {
          const scope = body.scope === "global" ? "global" : "project"
          const response = await target.request(`/config/overlay?scope=${scope}`, { headers })
          const overlay = (await response.json()) as Overlay
          const expected = overlay.targets[scope]
          return { ...body, expected: { path: expected.path, revision: expected.revision } }
        })()
      : body
  return target.request(input, {
    ...init,
    headers,
    body: next ? JSON.stringify(next) : init?.body,
  })
}

export async function json<T>(response: Response) {
  if (response.status !== 200) throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  return (await response.json()) as T
}

export async function config(dir: string, value: unknown) {
  await Bun.write(path.join(dir, "kilo.json"), JSON.stringify(value, null, 2))
}

export async function setGlobal(dir: string, value: Config.Info) {
  ;(Global.Path as { config: string }).config = dir
  await json(
    await request(Server.Default().app, undefined, "/config/overlay", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "global", set: value }),
    }),
  )
}
// kilocode_change end
