// Reuses the installed Kilo CLI login for a development server profile: the auth file is read and its Kilo
// account is imported through `auth import`, so the profile owns a normal credential and later sign-in or
// logout stays in the development instance.
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path from "node:path"

export type Entry = {
  id: string
  integrationID: string
  label: string
  active: boolean
  value: Record<string, unknown>
}

export function login(auth: unknown): Entry | undefined {
  const account = record(auth) && record(auth.kilo) ? auth.kilo : undefined
  if (!account) return undefined
  const organizationID = typeof account.accountId === "string" ? account.accountId : null
  if (account.type === "oauth" && text(account.access)) {
    return {
      id: "cred_kilo_cli",
      integrationID: "kilo",
      label: "Kilo CLI login",
      active: true,
      value: {
        type: "oauth",
        methodID: "device",
        refresh: text(account.refresh) ?? account.access,
        access: account.access,
        expires: typeof account.expires === "number" && account.expires > 0 ? account.expires : 0,
        metadata: { organizationID },
      },
    }
  }
  const key = text(account.key)
  if (!key) return undefined
  return {
    id: "cred_kilo_cli",
    integrationID: "kilo",
    label: "Kilo CLI login",
    active: true,
    value: { type: "key", key, metadata: { organizationID } },
  }
}

/** Imports the installed CLI login into `profile` once. Returns false when there is no login to reuse. */
export async function reuse(input: { profile: string; workspace: string; script: string }): Promise<boolean> {
  const marker = path.join(input.profile, "reused-cli-login")
  if (await Bun.file(marker).exists()) return false
  if (process.env.KILO_API_KEY || process.env.KILOCODE_TOKEN || process.env.KILO_AUTH_CONTENT) return false
  const file = path.join(
    process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share"),
    "kilo",
    "auth.json",
  )
  const entry = login(await Bun.file(file).json().catch(() => undefined))
  if (!entry) return false
  const directory = await mkdtemp(path.join(tmpdir(), "kilo-vscode-auth-"))
  const seed = path.join(directory, "auth.json")
  try {
    await writeFile(seed, JSON.stringify([entry]), { mode: 0o600 })
    const child = Bun.spawn([process.execPath, input.script, "auth", "import", "--standalone", seed], {
      cwd: input.workspace,
      env: { ...process.env, KILO_V2_PROFILE: input.profile, INIT_CWD: input.workspace },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (code !== 0) throw new Error(stderr.trim() || stdout.trim() || `auth import exited with code ${code}`)
    // The profile now owns its login. A later sign-in or logout must not be overwritten by the CLI file.
    await writeFile(marker, "")
    return true
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown) {
  return typeof value === "string" && value ? value : undefined
}
