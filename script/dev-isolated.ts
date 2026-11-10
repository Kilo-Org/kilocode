// `bun dev` on the v2 branch: runs the Kilo host entry (packages/kilo-cli) from this checkout with a profile
// that is separate from installed Kilo and OpenCode. Data, config, state, cache, home and tmp all live under one
// directory, so no global store, managed service or database outside it is read or changed. The default profile
// is in the host package, which ignores it (packages/kilo-cli/.gitignore).
import path from "node:path"
import { mkdir } from "node:fs/promises"

const root = path.resolve(import.meta.dir, "..")
const host = path.join(root, "packages/kilo-cli")
const profile = path.resolve(process.env.KILO_V2_PROFILE ?? path.join(host, ".kilo-v2-dev"))
const dirs = ["data", "config", "state", "cache", "home", "tmp"].map((name) => path.join(profile, name))
await Promise.all(dirs.map((dir) => mkdir(dir, { recursive: true })))
console.error(`kilo v2 dev profile: ${profile}`)

const args = process.argv.slice(2)
// A shell or terminal of a Kilo or OpenCode server inherits that server's database, config, home, session and
// password, and the CLI would use them instead of the profile. Pass config with OPENCODE_CONFIG_CONTENT instead.
const inherited = [
  "OPENCODE_DB",
  "KILO2_DB",
  "OPENCODE_CONFIG",
  "KILO2_CONFIG",
  "OPENCODE_CONFIG_DIR",
  "KILO2_CONFIG_DIR",
  "OPENCODE_HOME_DIR",
  "OPENCODE_APP_DIR_NAME",
  "OPENCODE_SESSION_ID",
  "OPENCODE_SERVER_PASSWORD",
  "KILO_SERVER_PASSWORD",
  // The client of that server. A client that starts its own server here (`serve --stdio`, as the VS Code extension
  // does from a checkout) passes its own.
  ...(args.includes("--stdio") ? [] : ["OPENCODE_CLIENT", "KILO_CLIENT", "KILO_PLATFORM", "KILO_AGENT_MANAGER_HOST"]),
]

const child = Bun.spawn([process.execPath, path.join(host, "src/index.ts"), ...args], {
  // The CLI uses the working directory as the project directory.
  cwd: process.env.INIT_CWD ?? process.cwd(),
  env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !inherited.includes(key))),
    // Default to the free Kilo model unless the caller passes its own config.
    ...(process.env.OPENCODE_CONFIG_CONTENT
      ? {}
      : { OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: "kilo/kilo-auto/free" }) }),
    // Bun children must load the same JSX transform, even when their cwd has no CLI bunfig.toml.
    BUN_OPTIONS: [
      process.env.BUN_OPTIONS,
      "--preload",
      path.join(host, "src/branding/preload.ts").replace(/[\s\\"']/g, (char) => `\\${char}`),
    ]
      .filter(Boolean)
      .join(" "),
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
})
process.exit(await child.exited)
