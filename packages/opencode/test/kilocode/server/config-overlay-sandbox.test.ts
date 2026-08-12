// kilocode_change start - split out of config-overlay.test.ts; see config-overlay-shared.ts
// for why. Test bodies are unchanged.
import { describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "@opencode-ai/core/global"
import { Server } from "../../../src/server/server"
import { PtyPaths } from "../../../src/server/routes/instance/httpapi/groups/pty"
import { SessionPaths } from "../../../src/server/routes/instance/httpapi/groups/session"
import { SandboxStore } from "../../../src/kilocode/sandbox/store"
import type { Session } from "../../../src/session/session"
import { tmpdir } from "../../fixture/fixture"
import { json, req, request, setGlobal, setup, terminal } from "./config-overlay-shared"

setup()

describe("config overlay routes: sandbox and terminals", () => {
  test.serial(
    "applies saved global sandbox settings to initialized sessions",
    async () => {
      await using global = await tmpdir()
      await using project = await tmpdir({ git: true })
      await using writable = await tmpdir()
      await setGlobal(global.path, { sandbox: { enabled: true, network: "deny" } })
      const session = await json<Session.Info>(
        await req(project.path, SessionPaths.create, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      )
      await json(await req(project.path, `/session/${session.id}/sandbox`))
      expect(await SandboxStore.read(project.path, session.id)).toMatchObject({ mode: "deny", version: 0 })

      await json(
        await req(project.path, "/config/overlay", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scope: "global",
            set: { sandbox: { enabled: true, network: "allow", writable_paths: [writable.path] } },
          }),
        }),
      )

      // The global update disposes instances asynchronously. Poll the sandbox status
      // until the reloaded instance applies the saved policy, mirroring how the
      // extension re-checks status after saving settings.
      for (let i = 0; i < 40; i++) {
        await json(await req(project.path, `/session/${session.id}/sandbox`))
        const snap = await SandboxStore.read(project.path, session.id)
        if (snap && snap.mode === "allow" && snap.writablePaths.includes(writable.path) && snap.version === 1) break
        await Bun.sleep(250)
      }

      expect(await SandboxStore.read(project.path, session.id)).toMatchObject({
        enabled: true,
        mode: "allow",
        writablePaths: [writable.path],
        version: 1,
      })
    },
    60_000,
  )

  test.serial("applies saved project sandbox settings to initialized sessions", async () => {
    await using global = await tmpdir()
    await using project = await tmpdir({ git: true })
    await setGlobal(global.path, { sandbox: { enabled: true, network: "allow" } })
    const session = await json<Session.Info>(
      await req(project.path, SessionPaths.create, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    )
    await json(await req(project.path, `/session/${session.id}/sandbox`))
    expect(await SandboxStore.read(project.path, session.id)).toMatchObject({ mode: "allow", version: 0 })

    await json(
      await req(project.path, "/config/overlay", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "project", set: { sandbox: { enabled: true, network: "deny" } } }),
      }),
    )
    await json(await req(project.path, `/session/${session.id}/sandbox`))

    expect(await SandboxStore.read(project.path, session.id)).toMatchObject({ mode: "deny", version: 1 })
  })

  test.serial("does not relax inherited sandbox policy after unrelated global saves", async () => {
    await using global = await tmpdir()
    await using project = await tmpdir({ git: true })
    await setGlobal(global.path, { sandbox: { enabled: true, network: "deny" } })
    const parent = await json<Session.Info>(
      await req(project.path, SessionPaths.create, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    )
    await json(await req(project.path, `/session/${parent.id}/sandbox`))
    const child = await json<Session.Info>(
      await req(project.path, SessionPaths.create, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parentID: parent.id }),
      }),
    )
    await json(await req(project.path, `/session/${child.id}/sandbox`))
    expect(await SandboxStore.read(project.path, child.id)).toMatchObject({ mode: "deny" })

    // Simulate config changing while the backend is unaware. The unrelated save below
    // must not treat that wider policy as a trusted sandbox settings update.
    await Bun.write(
      path.join(global.path, "kilo.json"),
      JSON.stringify({ sandbox: { enabled: true, network: "allow" } }, null, 2),
    )

    await json(
      await req(project.path, "/config/overlay", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "global", set: { permission: { edit: "ask" } } }),
      }),
    )
    await json(await req(project.path, `/session/${child.id}/sandbox`))

    expect(await SandboxStore.read(project.path, child.id)).toMatchObject({ mode: "deny" })
  })

  terminal("preserves active terminals after updating global console preferences", async () => {
    await using global = await tmpdir()
    await using project = await tmpdir()
    ;(Global.Path as { config: string }).config = global.path
    const headers = { "x-kilo-directory": project.path }
    const created = await Server.Default().app.request(PtyPaths.create, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ command: "/usr/bin/env", args: ["sh", "-c", "sleep 30"], title: "console" }),
    })
    const info = await json<{ id: string }>(created)

    try {
      await json(
        await request(Server.Default().app, undefined, "/config/overlay", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scope: "global", set: { console: { diff_style: "split" } } }),
        }),
      )

      const found = await Server.Default().app.request(PtyPaths.get.replace(":ptyID", info.id), { headers })
      expect(found.status).toBe(200)
      expect(await found.json()).toMatchObject({ id: info.id, title: "console", status: "running" })
    } finally {
      await Server.Default().app.request(PtyPaths.remove.replace(":ptyID", info.id), { method: "DELETE", headers })
    }
  })
})
// kilocode_change end
