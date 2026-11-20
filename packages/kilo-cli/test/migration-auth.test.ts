import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
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
    enterpriseUrl: "https://synthetic.example.invalid",
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
  const previewStore = path.join(path.dirname(preview), "kilo2.db")
  await bootstrap(previewStore, root)
  const originalID = (() => {
    using db = new Database(previewStore, { readonly: true })
    return db.query("SELECT id FROM credential WHERE integration_id='openai'").get()
  })()
  expect(originalID).toBeTruthy()
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
    metadata: { accountID: oauth.accountId, enterpriseUrl: oauth.enterpriseUrl },
  })
  expect(db.query("SELECT id FROM credential WHERE integration_id='openai'").get()).toEqual(originalID)
  expect(readFileSync(preview, "utf8")).toBe(previewText)
  expect(JSON.parse((await run("preflight")).stdout).status).toBe("completed")
  renameSync(previewStore, `${previewStore}.archived`)
  expect(JSON.parse((await run("preflight")).stdout).status).toBe("completed")
  renameSync(`${previewStore}.archived`, previewStore)
  expect(JSON.parse((await run("preflight")).stdout).status).toBe("completed")
  {
    using writer = new Database(previewStore)
    writer.run("INSERT INTO project(id,worktree,time_created,time_updated,sandboxes) VALUES('fixture',?,1,1,'[]')", [
      root,
    ])
    writer.run(
      "INSERT INTO session_v2(id,project_id,slug,directory,title,version,time_created,time_updated) VALUES('ses_later','fixture','later',?,'Later preview history','2',1,2)",
      [root],
    )
  }
  const changed = await run("preflight")
  expect(changed.code).not.toBe(0)
  expect(changed.stderr).toContain(previewStore)
}, 90_000)

async function bootstrap(file: string, root: string) {
  const { Database } = await import("@opencode/core/database/database")
  const { FSUtil } = await import("@opencode/util/fs-util")
  const paths = Object.fromEntries(
    ["home", "cache", "config", "state", "tmp", "bin", "log", "repos"].map((k) => [k, path.join(root, k)]),
  )
  await Effect.runPromise(
    Effect.scoped(
      Layer.build(
        AppNodeBuilder.build(LayerNode.group([Database.node, Global.node, FSUtil.node]), [
          Database.node.replace(Database.configured({ path: file })),
          Global.node.replace(Global.layerWith({ ...paths, data: path.dirname(file) })),
        ]),
      ),
    ),
  )
}
