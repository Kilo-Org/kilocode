import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { promises as fs } from "fs"
import path from "path"
import os from "os"
import { Hono } from "hono"
import { createFileSystemTeamRepository } from "@/devilcode/team/repository"
import { createQuickstartTeamRepository } from "@/devilcode/team/repositories/quickstart"
import { createLayeredTeamRepository } from "@/devilcode/team/layered-repository"
import { loadQuickstartTemplates, QUICKSTART_IDS } from "@/devilcode/team/quickstarts"
import { CanonicalTeamConfig } from "@/devilcode/team/config"

// ---------------------------------------------------------------------------
// Helpers — build a minimal Hono app that mirrors the config.ts routes logic
// but with an injected rootDir so we can use a temp directory in tests.
// ---------------------------------------------------------------------------

function buildTeamApp(rootDir: string) {
  const app = new Hono()

  app.get("/config/team", async (c) => {
    const repo = createLayeredTeamRepository({
      layers: [
        { name: "user", repository: createFileSystemTeamRepository({ rootDir }), writable: true },
        { name: "quickstart", repository: createQuickstartTeamRepository(), writable: false },
      ],
    })
    const handles = await repo.listTeams()
    return c.json(handles)
  })

  app.get("/config/team/:id", async (c) => {
    const id = c.req.param("id")
    const repo = createLayeredTeamRepository({
      layers: [
        { name: "user", repository: createFileSystemTeamRepository({ rootDir }), writable: true },
        { name: "quickstart", repository: createQuickstartTeamRepository(), writable: false },
      ],
    })
    try {
      const config = await repo.loadTeam(id)
      return c.json(config)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/not found/i.test(msg)) {
        return c.json({ error: "not found", id }, 404)
      }
      throw err
    }
  })

  app.put("/config/team/:id", async (c) => {
    const id = c.req.param("id")
    const payload = await c.req.json()
    const result = CanonicalTeamConfig.safeParse(payload)
    if (!result.success) {
      return c.json({ error: "validation failed", issues: result.error.issues.map((i) => i.message) }, 400)
    }
    const repo = createFileSystemTeamRepository({ rootDir })
    const handle = await repo.saveTeam(id, result.data)
    return c.json(handle)
  })

  app.delete("/config/team/:id", async (c) => {
    const id = c.req.param("id")
    if ((QUICKSTART_IDS as readonly string[]).includes(id)) {
      return c.json({ error: "cannot delete quickstart team" }, 400)
    }
    const repo = createFileSystemTeamRepository({ rootDir })
    try {
      await repo.deleteTeam(id)
      return c.json({ deleted: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/not found/i.test(msg) || (err as { code?: string })?.code === "ENOENT") {
        return c.json({ error: "not found", id }, 404)
      }
      throw err
    }
  })

  return app
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
let tmpDir: string
let app: Hono

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "team-routes-test-"))
  app = buildTeamApp(tmpDir)
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe("GET /config/team", () => {
  it("returns an array (quickstart teams when no user teams exist)", async () => {
    const res = await app.request("/config/team")
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
    // Quickstart repo always provides QUICKSTART_IDS
    expect(body.length).toBeGreaterThanOrEqual(QUICKSTART_IDS.length)
  })

  it("includes user-saved teams in the list", async () => {
    // Pre-save a user team into tmpDir
    const templates = loadQuickstartTemplates()
    const config = templates["solo-enhanced"].team
    const repo = createFileSystemTeamRepository({ rootDir: tmpDir })
    await repo.saveTeam("my-user-team", config)

    const res = await app.request("/config/team")
    expect(res.status).toBe(200)
    const body = await res.json() as Array<{ id: string }>
    const ids = body.map((h) => h.id)
    expect(ids).toContain("my-user-team")
  })

  it("each handle has id, name, path, updatedAt fields", async () => {
    const res = await app.request("/config/team")
    const body = await res.json() as Array<Record<string, unknown>>
    for (const handle of body) {
      expect(typeof handle.id).toBe("string")
      expect(typeof handle.name).toBe("string")
      expect(typeof handle.path).toBe("string")
      expect(typeof handle.updatedAt).toBe("string")
    }
  })
})

describe("GET /config/team/:id", () => {
  it("returns 404 for unknown id", async () => {
    const res = await app.request("/config/team/nonexistent-team-xyz")
    expect(res.status).toBe(404)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/not found/i)
  })

  it("returns team config for a valid quickstart id", async () => {
    const res = await app.request("/config/team/solo-enhanced")
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty("roles")
    expect(body).toHaveProperty("routing")
  })

  it("returns user-saved team config by id", async () => {
    const templates = loadQuickstartTemplates()
    const config = templates["code-review-pair"].team
    const repo = createFileSystemTeamRepository({ rootDir: tmpDir })
    await repo.saveTeam("saved-team", config)

    const res = await app.request("/config/team/saved-team")
    expect(res.status).toBe(200)
    const body = await res.json() as Record<string, unknown>
    expect(body).toHaveProperty("roles")
  })
})

describe("PUT /config/team/:id", () => {
  it("saves a valid team config and returns a handle", async () => {
    const templates = loadQuickstartTemplates()
    const config = templates["full-stack-team"].team

    const res = await app.request("/config/team/put-test-team", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    })
    expect(res.status).toBe(200)
    const handle = await res.json() as { id: string; path: string; updatedAt: string }
    expect(handle.id).toBe("put-test-team")
    expect(typeof handle.updatedAt).toBe("string")

    // Verify persisted on disk
    const saved = await fs.readFile(path.join(tmpDir, "put-test-team.json"), "utf-8")
    expect(JSON.parse(saved)).toHaveProperty("roles")
  })

  it("returns 400 for invalid team config payload", async () => {
    const res = await app.request("/config/team/bad-team", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, roles: {} }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: string }
    expect(body.error).toMatch(/validation/i)
  })

  it("overwrites an existing team on second PUT", async () => {
    const templates = loadQuickstartTemplates()
    const config1 = templates["solo-enhanced"].team
    const config2 = templates["code-review-pair"].team

    await app.request("/config/team/overwrite-team", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config1),
    })
    const res2 = await app.request("/config/team/overwrite-team", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config2),
    })
    expect(res2.status).toBe(200)

    // Load and confirm the second config was saved
    const getRes = await app.request("/config/team/overwrite-team")
    expect(getRes.status).toBe(200)
    const body = await getRes.json() as { routing: { defaultRole: string } }
    expect(body.routing.defaultRole).toBe(config2.routing.defaultRole)
  })
})

describe("DELETE /config/team/:id", () => {
  it("removes a user team and returns { deleted: true }", async () => {
    const templates = loadQuickstartTemplates()
    const config = templates["solo-enhanced"].team
    const repo = createFileSystemTeamRepository({ rootDir: tmpDir })
    await repo.saveTeam("delete-me", config)

    const res = await app.request("/config/team/delete-me", { method: "DELETE" })
    expect(res.status).toBe(200)
    const body = await res.json() as { deleted: boolean }
    expect(body.deleted).toBe(true)

    // Confirm file is gone
    const exists = await fs.stat(path.join(tmpDir, "delete-me.json")).then(() => true).catch(() => false)
    expect(exists).toBe(false)
  })

  it("rejects deletion of quickstart team ids with 400", async () => {
    for (const qid of QUICKSTART_IDS) {
      const res = await app.request(`/config/team/${qid}`, { method: "DELETE" })
      expect(res.status).toBe(400)
      const body = await res.json() as { error: string }
      expect(body.error).toMatch(/quickstart/i)
    }
  })

  it("returns 404 when deleting a non-existent user team", async () => {
    const res = await app.request("/config/team/does-not-exist", { method: "DELETE" })
    expect(res.status).toBe(404)
  })
})
