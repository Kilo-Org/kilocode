// `bun dev` on the v2 branch: runs the CLI from this checkout with a profile that is separate from
// installed Kilo and OpenCode. Data, config, state, cache, home and tmp all live under one directory,
// so no global store, managed service or database outside it is read or changed.
import os from "node:os"
import path from "node:path"
import { mkdir } from "node:fs/promises"

const root = path.resolve(import.meta.dir, "..")
const profile = path.resolve(process.env.KILO_V2_PROFILE ?? path.join(root, ".kilo-v2-dev"))
const dirs = ["data", "config", "state", "cache", "home", "tmp"].map((name) => path.join(profile, name))
await Promise.all(dirs.map((dir) => mkdir(dir, { recursive: true })))
const login = await kiloLogin()
console.error(`kilo v2 dev profile: ${profile}${login.KILO_API_KEY ? " (Kilo login from v1 Kilo)" : ""}`)

const child = Bun.spawn(
  [
    process.execPath,
    "--preload",
    Bun.resolveSync("@opentui/solid/preload", path.join(root, "packages/cli")),
    path.join(root, "packages/cli/src/index.ts"),
    ...process.argv.slice(2),
  ],
  {
    // The CLI uses the working directory as the project directory.
    cwd: process.env.INIT_CWD ?? process.cwd(),
    env: {
      ...process.env,
      ...login,
      XDG_DATA_HOME: dirs[0],
      XDG_CONFIG_HOME: dirs[1],
      XDG_STATE_HOME: dirs[2],
      XDG_CACHE_HOME: dirs[3],
      OPENCODE_TEST_HOME: dirs[4],
      TMPDIR: dirs[5],
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
)
process.exit(await child.exited)

// Development only: reuse the v1 Kilo login so the Kilo Gateway works without a separate sign-in,
// billed to the selected team like v1. The v1 auth file is only read. KILO_API_KEY in the
// environment wins. Product login (device auth, team switching) replaces this later.
async function kiloLogin(): Promise<Record<string, string>> {
  const config = (headers: Record<string, string>) =>
    process.env.OPENCODE_CONFIG_CONTENT
      ? {}
      : {
          OPENCODE_CONFIG_CONTENT: JSON.stringify({
            model: "kilo/kilo-auto/free",
            provider: { kilo: { options: { headers } } },
          }),
        }
  if (process.env.KILO_API_KEY) return config({})
  const file = Bun.file(
    path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "kilo", "auth.json"),
  )
  if (!(await file.exists())) return config({})
  const auth = (await file.json()).kilo
  if (auth?.type !== "oauth" || typeof auth.access !== "string") return config({})
  return {
    KILO_API_KEY: auth.access,
    ...config(typeof auth.accountId === "string" ? { "X-KILOCODE-ORGANIZATIONID": auth.accountId } : {}),
  }
}
