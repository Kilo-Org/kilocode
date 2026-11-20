import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Profile } from "../src/profile"
import { wrap } from "../src/nono"
import { binary, environment, support } from "../src/nono-binary"
import { parse, type Credential } from "../src/nono-credentials"
import { generate } from "../src/nono-profile"

// The matrix is only evidence for the pinned binary, so the support check runs before the fixture moves the
// sandbox state away from the staged install.
const status = support()
if (!status.available) {
  console.error(status.reason ?? "nono is unavailable")
  process.exit(2)
}
const nono = binary()
if (!nono) {
  console.error("nono is unavailable")
  process.exit(2)
}
if (Bun.spawnSync({ cmd: ["curl", "--version"], stdout: "ignore", stderr: "ignore" }).exitCode !== 0) {
  console.error("curl is required for the network probes")
  process.exit(2)
}

const canary = "kilo-poc-canary-9f3a"
const secret = "poc-real-secret-71c4"
// The fixture lives under the real home: nono refuses a system read grant that overlaps its own state
// root, and a state root below $TMPDIR sits inside /private/var on macOS.
const root = realpathSync.native(mkdtempSync(path.join(os.homedir(), ".kilo-nono-poc-")))
const home = path.join(root, "home")
const workspace = path.join(root, "workspace")
const state = path.join(root, "state")
const data = path.join(root, "data")
const config = path.join(root, "config")
const temporary = path.join(root, "tmp")

process.env.KILO_NONO_STATE = path.join(state, "sandbox")
process.env.KILO_NONO_HOME = path.join(root, "nono")

for (const dir of [home, workspace, state, data, config, temporary, path.join(home, ".ssh"), path.join(home, ".aws")]) {
  mkdirSync(dir, { recursive: true })
}
writeFileSync(path.join(home, ".ssh", "id_ed25519"), canary)
writeFileSync(path.join(home, ".aws", "credentials"), canary)
writeFileSync(path.join(home, ".zshrc"), `export GITHUB_TOKEN=${canary}\n`)
writeFileSync(path.join(workspace, "readme.txt"), canary)
mkdirSync(path.join(workspace, ".git"))
writeFileSync(path.join(workspace, ".git", "config"), "original")
writeFileSync(path.join(data, "kilo2.db"), canary)

const echo = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    return Response.json({ authorization: request.headers.get("authorization") })
  },
})
const route: Credential = {
  name: "demo",
  source: "env://DEMO_TOKEN",
  envVar: "DEMO_TOKEN",
  upstream: `http://127.0.0.1:${echo.port}`,
  header: "Authorization",
  format: "Bearer {}",
}
const routes = parse({ credentials: [route] })

const local: Profile = {
  filesystem: {
    allowWrite: [
      { path: workspace, kind: "subtree" },
      { path: state, kind: "subtree" },
      { path: data, kind: "subtree" },
      { path: config, kind: "subtree" },
      { path: temporary, kind: "subtree" },
    ],
    denyWrite: [{ path: process.env.KILO_NONO_STATE, kind: "subtree" }],
    denyNames: [".git"],
    temporaryDirectory: temporary,
  },
  network: { mode: "deny", allowedHosts: [] },
  environment: { deny: [], set: { TMPDIR: temporary, TMP: temporary, TEMP: temporary } },
}

const proxied: Profile = { ...local, network: { mode: "proxy", allowedHosts: ["example.com:443"] } }

/** Stands in for a user XDG value the profile must restore after nono's own redirect. */
const original = path.join(root, "original")

async function child(profile: Profile, script: string) {
  const generated = generate(profile, {
    credentials: routes,
    paths: { data, config },
    cwd: workspace,
    restore: { NODE_OPTIONS: "--poc-marker", XDG_CONFIG_HOME: original },
    secret: ["GH_TOKEN"],
  })
  const dir = path.join(process.env.KILO_NONO_STATE!, "profiles")
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `poc-${Math.random().toString(16).slice(2)}.json`)
  writeFileSync(file, JSON.stringify(generated))
  const env = {
    ...process.env,
    HOME: home,
    DEMO_TOKEN: secret,
    GH_TOKEN: secret,
    NODE_OPTIONS: "--poc-marker",
    XDG_CONFIG_HOME: original,
  }
  const launch = wrap({
    binary: nono!,
    profile: file,
    launch: { command: script, args: [], cwd: workspace, environment: env, shell: "/bin/sh" },
    environment: environment(env),
    allowCwd: generated.workdir.access !== "none",
  })
  // Asynchronous on purpose: the fixture echo upstream runs in this process and must answer while nono runs.
  const proc = Bun.spawn({
    cmd: [launch.command, ...launch.args],
    cwd: launch.cwd,
    env: launch.environment,
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(60_000),
  })
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return {
    code: await proc.exited,
    out,
    err,
    profile: readFileSync(file, "utf8"),
    profileFile: file,
  }
}

type Child = Awaited<ReturnType<typeof child>>

/**
 * A denial is nono's EPERM on an existing fixture, not any non-zero exit. A missing binary, a bad path or a
 * failed exec must fail the probe instead of passing it as enforcement.
 */
function refused(result: Child) {
  return result.code !== 0 && result.err.includes("Operation not permitted")
}

function refusal(result: Child) {
  return refused(result) ? "denied" : `exit ${result.code}: ${result.err.trim() || result.out.trim() || "no output"}`
}

type Row = { probe: string; expected: string; result: string; ok: boolean | "recorded" }

const rows: Row[] = []
function check(probe: string, expected: string, ok: boolean | "recorded", result: string) {
  rows.push({ probe, expected, result, ok })
}

try {
  const control = await child(local, "printf ok")
  if (control.code !== 0 || control.out !== "ok") {
    console.error("nono could not run the control command, so the matrix would be meaningless.")
    console.error(control.err.trim() || `exit ${control.code}`)
    process.exit(2)
  }

  const ssh = await child(local, 'cat "$HOME/.ssh/id_ed25519"')
  check("P1 read ~/.ssh", "denied", refused(ssh) && !ssh.out.includes(canary), refusal(ssh))

  const readable = await child(local, "cat readme.txt")
  check(
    "P2 read workspace",
    "allowed",
    readable.code === 0 && readable.out.includes(canary),
    readable.code === 0 ? "read" : "denied",
  )

  const written = await child(local, "printf ok > written.txt && cat written.txt")
  check(
    "P3 write workspace",
    "allowed",
    written.code === 0 && existsSync(path.join(workspace, "written.txt")),
    written.code === 0 ? "written" : "denied",
  )

  const escape = await child(local, 'printf nope > "$HOME/escape.txt"')
  check("P4 write $HOME", "denied", refused(escape) && !existsSync(path.join(home, "escape.txt")), refusal(escape))

  const git = await child(local, "printf nope > .git/config")
  check("P5 write .git", "recorded", "recorded", git.code === 0 ? "written (known gap)" : "denied")

  const egress = await child(local, "curl -sS -m 5 https://example.com")
  check("P6 egress deny mode", "blocked", egress.code !== 0, egress.code === 0 ? "connected" : "blocked")

  const injected = await child(
    proxied,
    'curl -sS -i -m 10 --noproxy 127.0.0.1 -H "Authorization: Bearer $DEMO_TOKEN" -H "X-Nono-Token: $NONO_PROXY_TOKEN" "$DEMO_BASE_URL/echo"',
  )
  const header = injected.out.trim()
  check(
    "P7 credential route",
    "real secret at upstream",
    injected.code === 0 && header.includes(secret),
    header || injected.err.trim() || "empty response",
  )

  const blocked = await child(proxied, "curl -sS -m 5 https://example.org")
  check("P8 non-allowlisted host", "blocked", blocked.code !== 0, blocked.code === 0 ? "connected" : "blocked")

  if (process.env.KILO_NONO_POC_NETWORK === "1") {
    const allowed = await child(proxied, "curl -sS -m 15 -o /dev/null -w '%{http_code}' https://example.com")
    check(
      "P16 allowlisted host",
      "reachable",
      allowed.code === 0 && allowed.out.trim() === "200",
      `${allowed.out.trim() || "-"} exit ${allowed.code}${allowed.err.trim() ? ` ${allowed.err.trim()}` : ""}`,
    )
  } else {
    check("P16 allowlisted host", "network gated", "recorded", "set KILO_NONO_POC_NETWORK=1")
  }

  check("P9 direct credential host", "documented, not probed", "recorded", "accepted behavior")

  const aliased = await child(proxied, 'printf "%s|%s" "$DEMO_TOKEN" "$GH_TOKEN"')
  const [token = "", alias = ""] = aliased.out.split("|")
  check(
    "P10 phantom + aliases",
    "phantom, no alias",
    /^[0-9a-f]{64}$/.test(token) && alias === "" && !aliased.out.includes(secret),
    token ? `phantom ${token.slice(0, 12)}…` : aliased.err.trim(),
  )

  const store = await child(local, `cat "${path.join(data, "kilo2.db")}"`)
  check("P11 read Kilo store", "denied", refused(store) && !store.out.includes(canary), refusal(store))

  const self = await child(local, `cat "${readable.profileFile}"`)
  check("P12 read own profile", "denied", refused(self), refusal(self))

  check(
    "P13 secret in profile",
    "absent",
    !readable.profile.includes(secret),
    readable.profile.includes(secret) ? "present" : "absent",
  )

  const restored = await child(local, 'printf "%s" "$NODE_OPTIONS"')
  check("P14 loader variable restored", "present", restored.out.includes("--poc-marker"), restored.out || "absent")

  const restoredXdg = await child(local, 'printf "%s" "$XDG_CONFIG_HOME"')
  check("P15 XDG value restored", original, restoredXdg.out === original, restoredXdg.out || "absent")

  const devices = await child(local, "printf ok >/dev/null 2>&1 && printf done")
  check(
    "P17 device files",
    "allowed",
    devices.out === "done",
    devices.out || devices.err.trim() || `exit ${devices.code}`,
  )
} finally {
  echo.stop(true)
  rmSync(root, { recursive: true, force: true })
}

const width = Math.max(...rows.map((row) => row.probe.length)) + 2
for (const row of rows) {
  const status = row.ok === "recorded" ? "NOTE" : row.ok ? "PASS" : "FAIL"
  console.log(`${status}  ${row.probe.padEnd(width)}${row.expected.padEnd(28)}${row.result}`)
}
const executed = rows.filter((row) => row.ok !== "recorded")
const recorded = rows.length - executed.length
const failed = executed.filter((row) => row.ok === false)
console.log(
  `\n${executed.length - failed.length}/${executed.length} executed probes passed${recorded === 0 ? "" : `, ${recorded} recorded`}`,
)
process.exit(failed.length === 0 ? 0 : 1)
