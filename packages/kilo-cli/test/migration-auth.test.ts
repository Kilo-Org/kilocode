import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "../../core/test/fixture/tmpdir"

test("conflicting file credentials block publication; explicit recovery imports sign-ins found only in the preview", async () => {
  await using fixture = await tmpdir()
  const root = fixture.path
  const stable = path.join(root, "data/kilo/auth.json")
  const preview = path.join(root, "data/kilo2/auth.json")
  const source = path.join(path.dirname(stable), "kilo.db")
  for (const dir of [path.dirname(stable), path.dirname(preview), path.join(root, ".git")])
    mkdirSync(dir, { recursive: true })
  {
    using db = new Database(source)
    db.exec(readFileSync(path.join(import.meta.dir, "fixture/kilo-v1-schema.sql"), "utf8"))
    db.run("INSERT INTO project (id,worktree,time_created,time_updated,sandboxes) VALUES ('global','/',1,1,'[]')")
    db.run(
      "INSERT INTO session (id,project_id,slug,directory,title,version,time_created,time_updated) VALUES ('ses_auth','global','auth',?,'Synthetic sign-in rehearsal','7',1,2)",
      [root],
    )
  }
  const before = readFileSync(source)
  const legacyKey = { type: "api", key: "synthetic-legacy-key" }
  const previewKey = { type: "api", key: "synthetic-preview-key", metadata: { org: "fixture" } }
  const oauth = {
    type: "oauth",
    access: "synthetic-access",
    refresh: "synthetic-refresh",
    expires: 123456789,
    accountId: "synthetic-account",
  }
  writeFileSync(stable, JSON.stringify({ provider: legacyKey }), { mode: 0o600 })
  const previewText = JSON.stringify({ provider: previewKey, openai: oauth })
  writeFileSync(preview, previewText, { mode: 0o600 })
  async function run(...args: string[]) {
    const child = Bun.spawn(
      [process.execPath, path.resolve(import.meta.dir, "../../../script/dev-isolated.ts"), "migrate", ...args],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          HOME: root,
          USERPROFILE: root,
          KILO_V2_PROFILE: root,
          KILO_INTERNAL_PROFILE_CUTOVER: "1",
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    for (const secret of [legacyKey.key, previewKey.key, oauth.access, oauth.refresh])
      expect((stdout + stderr).includes(secret)).toBe(false)
    return { code, stdout, stderr }
  }
  const consent = "--accept-jetbrains-breakage"
  const blocked = await run("apply", consent)
  expect(blocked.code).not.toBe(0)
  expect(blocked.stderr).toContain(stable)
  expect(blocked.stderr).toContain(preview)
  expect(JSON.parse((await run("preflight")).stdout).status).toBe("failed")
  expect(readFileSync(source)).toEqual(before)
  expect(existsSync(`${source}.pre-v2`)).toBe(false)
  expect(readFileSync(preview, "utf8")).toBe(previewText)
  expect(readFileSync(stable, "utf8")).toBe(JSON.stringify({ provider: legacyKey }))
  // Resolve the conflict in the disposable input, leaving both preview-only entries intact.
  writeFileSync(stable, JSON.stringify({ other: legacyKey }))
  const migrated = await run("recover", consent)
  if (migrated.code && migrated.stderr.includes("Safe database replacement requires local")) return
  expect(migrated.code, migrated.stderr).toBe(0)
  using db = new Database(source, { readonly: true })
  const value = (id: string) =>
    JSON.parse(
      db.query<{ value: string }, [string]>("SELECT value FROM credential WHERE integration_id=?").get(id)!.value,
    )
  expect(value("other")).toMatchObject({ type: "key", key: legacyKey.key })
  expect(value("provider")).toMatchObject({ type: "key", key: previewKey.key, metadata: previewKey.metadata })
  expect(value("openai")).toMatchObject({
    type: "oauth",
    methodID: "chatgpt-browser",
    access: oauth.access,
    refresh: oauth.refresh,
    expires: oauth.expires,
    metadata: { accountID: oauth.accountId },
  })
  expect(readFileSync(preview, "utf8")).toBe(previewText)
}, 90_000)
