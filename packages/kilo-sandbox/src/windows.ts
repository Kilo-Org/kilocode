import fs from "node:fs"
import path from "node:path"
import { Effect } from "effect"
import type { Backend } from "./backend"

const profileKey = "KILO_SANDBOX_PROFILE"
const parentKey = "KILO_SANDBOX_PARENT_PID"
const overrideKey = "KILO_WINDOWS_SANDBOX_HELPER"

function helper() {
  const override = process.env[overrideKey]
  const file = override || path.join(path.dirname(process.execPath), "kilo-sandbox-win.exe")
  if (!path.isAbsolute(file)) throw new Error(`${overrideKey} must be an absolute path`)
  if (!fs.existsSync(file)) throw new Error(`Windows sandbox helper not found at ${file}`)
  return file
}

const support = (() => {
  try {
    helper()
    return { available: true } as const
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : String(error) } as const
  }
})()

export const windows: Backend = {
  support,
  prepare(profile, launch) {
    return Effect.sync(() => ({
      command: helper(),
      args: ["--", launch.command, ...launch.args],
      cwd: launch.cwd,
      environment: {
        ...launch.environment,
        [profileKey]: Buffer.from(
          JSON.stringify({
            version: 1,
            filesystem: profile.filesystem,
          }),
        ).toString("base64"),
        [parentKey]: String(process.pid),
      },
      shell: false,
    }))
  },
}
