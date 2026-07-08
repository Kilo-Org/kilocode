import { Effect } from "effect"
import { mkdir, rm } from "fs/promises"
import path from "path"
import { KiloMemory } from "@kilocode/kilo-memory/effect"
import { MemoryPaths } from "@kilocode/kilo-memory/effect/paths"
import { array, check, object } from "../../server/httpapi-exercise/assertions"
import { http, route } from "../../server/httpapi-exercise/dsl"
import type { Scenario, ScenarioContext } from "../../server/httpapi-exercise/types"
import { anacondaDesktopScenarios } from "../anaconda-desktop/httpapi-exercise-scenarios"

function directory(ctx: ScenarioContext) {
  if (!ctx.directory) throw new Error("scenario needs a project directory")
  return ctx.directory
}

function file(ctx: ScenarioContext, name: string, content: string) {
  const target = path.join(directory(ctx), name)
  return Effect.promise(async () => {
    await mkdir(path.dirname(target), { recursive: true })
    await Bun.write(target, content)
    return target
  })
}

function memory(ctx: ScenarioContext) {
  const dir = directory(ctx)
  return MemoryPaths.root({ ctx: { directory: dir, worktree: dir } })
}

function enable(ctx: ScenarioContext) {
  const dir = directory(ctx)
  return Effect.promise(() => KiloMemory.enable({ ctx: { directory: dir, worktree: dir } }))
}

const edit = {
  provider: "kilo",
  model: "inception/mercury-next-edit",
  currentFilePath: "src/index.ts",
  currentFileContent: "export const value = 1\n",
  cursorLine: 0,
  cursorCharacter: 0,
  editableRegionStartLine: 0,
  editableRegionEndLine: 0,
  recentlyViewedSnippets: [],
  editDiffHistory: [],
}

export const kiloScenarios: Scenario[] = [
  ...anacondaDesktopScenarios,
  http.protected.get("/background-process", "backgroundProcess.list").json(200, array),
  http.protected
    .get("/background-process/{processID}", "backgroundProcess.get")
    .at((ctx) => ({
      path: route("/background-process/{processID}", { processID: "bgp_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(404),
  http.protected
    .get("/background-process/{processID}/logs", "backgroundProcess.logs")
    .at((ctx) => ({
      path: route("/background-process/{processID}/logs", { processID: "bgp_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(404),
  http.protected
    .post("/background-process/{processID}/stop", "backgroundProcess.stop")
    .at((ctx) => ({
      path: route("/background-process/{processID}/stop", { processID: "bgp_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(404),
  http.protected
    .post("/background-process/{processID}/restart", "backgroundProcess.restart")
    .at((ctx) => ({
      path: route("/background-process/{processID}/restart", { processID: "bgp_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(404),
  http.protected
    .post("/background-process/session/{sessionID}/stop", "backgroundProcess.stopSession")
    .at((ctx) => ({
      path: route("/background-process/session/{sessionID}/stop", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => check(body === true, "session process stop should return true")),
  http.protected.get("/interactive-terminal", "interactiveTerminal.list").json(200, array),
  http.protected
    .get("/interactive-terminal/{terminalID}", "interactiveTerminal.get")
    .at((ctx) => ({
      path: route("/interactive-terminal/{terminalID}", { terminalID: "itx_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(404),
  http.protected
    .post("/interactive-terminal/{terminalID}/input", "interactiveTerminal.write")
    .at((ctx) => ({
      path: route("/interactive-terminal/{terminalID}/input", { terminalID: "itx_httpapi_missing" }),
      headers: ctx.headers(),
      body: { data: "x" },
    }))
    .status(404),
  http.protected
    .post("/interactive-terminal/{terminalID}/resize", "interactiveTerminal.resize")
    .at((ctx) => ({
      path: route("/interactive-terminal/{terminalID}/resize", { terminalID: "itx_httpapi_missing" }),
      headers: ctx.headers(),
      body: { cols: 1, rows: 1 },
    }))
    .status(404),
  http.protected
    .post("/interactive-terminal/{terminalID}/close", "interactiveTerminal.close")
    .at((ctx) => ({
      path: route("/interactive-terminal/{terminalID}/close", { terminalID: "itx_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(404),
  http.protected.get("/config/warnings", "config.warnings").json(200, array),
  http.protected.get("/config/effective", "config.effective").json(200, object),
  http.protected.get("/config/model-state", "config.modelState").json(200, object),
  http.protected
    .patch("/config/model-state", "config.modelStateUpdate")
    .at((ctx) => ({ path: "/config/model-state", headers: ctx.headers(), body: { favorite: [] } }))
    .json(200, object),
  http.protected.get("/config/overlay", "config.overlay").json(200, object),
  http.protected
    .patch("/config/overlay", "config.overlayUpdate")
    .mutating()
    .at((ctx) => ({ path: "/config/overlay", headers: ctx.headers(), body: { scope: "project", set: {} } }))
    .json(200, object),
  http.protected.get("/config/rules", "config.rules").json(200, object),
  http.protected
    .put("/config/rules", "config.rulesUpdate")
    .mutating()
    .at((ctx) => ({ path: "/config/rules", headers: ctx.headers(), body: { content: "Use small changes." } }))
    .json(200, object),
  http.protected
    .put("/auth/{providerID}", "auth.set")
    .mutating()
    .at((ctx) => ({
      path: route("/auth/{providerID}", { providerID: "openai" }),
      headers: ctx.headers(),
      body: { type: "api", key: "sk-httpapi-test" },
    }))
    .json(200, (body) => check(body === true, "provider auth set should return true")),
  http.protected
    .post("/mcp", "mcp.add")
    .mutating()
    .at((ctx) => ({
      path: "/mcp",
      headers: ctx.headers(),
      body: { name: "httpapi-mcp", config: { type: "remote", url: "https://mcp.example.test" } },
    }))
    .json(200, object),
  http.protected
    .post("/mcp", "mcp.add")
    .mutating()
    .at((ctx) => ({
      path: "/mcp",
      headers: ctx.headers(),
      body: { name: "httpapi-mcp", config: { type: "remote", url: "https://mcp-edit.example.test" } },
    }))
    .json(200, object),
  http.protected.get("/config/sources", "config.sources").json(200, object),
  http.protected.get("/tui/config", "tui.config.get").json(200, object),
  http.protected.get("/tui/keybinds", "tui.keybind.list").json(200, object),
  http.protected
    .patch("/tui/config", "tui.config.update")
    .mutating()
    .at((ctx) => ({ path: "/tui/config?scope=project", headers: ctx.headers(), body: { theme: "nord" } }))
    .json(200, object),
  http.protected
    .post("/agent-builder/preview", "agent.builder.preview")
    .at((ctx) => ({
      path: "/agent-builder/preview",
      headers: ctx.headers(),
      body: { id: "httpapi-agent", scope: "project", mode: "subagent", prompt: "Review changes." },
    }))
    .json(200, object),
  http.protected
    .put("/agent-builder/{id}", "agent.builder.save")
    .mutating()
    .at((ctx) => ({
      path: route("/agent-builder/{id}", { id: "httpapi-agent" }),
      headers: ctx.headers(),
      body: { id: "httpapi-agent", scope: "project", mode: "subagent", prompt: "Review changes." },
    }))
    .json(200, object),
  http.protected
    .get("/experimental/worktree/diff", "worktree.diff")
    .at((ctx) => ({ path: "/experimental/worktree/diff?base=HEAD", headers: ctx.headers() }))
    .json(200, array),
  http.protected
    .get("/experimental/worktree/diff/summary", "worktree.diffSummary")
    .at((ctx) => ({ path: "/experimental/worktree/diff/summary?base=HEAD", headers: ctx.headers() }))
    .json(200, array),
  http.protected
    .get("/experimental/worktree/diff/file", "worktree.diffFile")
    .at((ctx) => ({
      path: `/experimental/worktree/diff/file?${new URLSearchParams({ base: "HEAD", file: "missing.txt" })}`,
      headers: ctx.headers(),
    }))
    .json(200, (body) => check(body === null, "missing worktree diff detail should return null")),
  http.protected.get("/indexing/status", "indexing.status").json(200, object),
  http.protected.get("/indexing/models", "indexing.models").json(200, object),
  http.protected.get("/indexing/warnings", "indexing.warnings").json(200, array),
  http.protected.get("/memory/status", "memory.status").json(200, (body) => {
    object(body)
    object(body.state)
    object(body.index)
    check(body.state.enabled === false, "memory should start disabled")
    check(body.state.autoConsolidate === true, "memory auto-save should be configured on by default")
    check(body.index.estimatedTokens === 0, "missing memory should report zero tokens")
  }),
  http.protected
    .post("/memory/enable", "memory.enable")
    .mutating()
    .json(200, (body) => {
      object(body)
      object(body.state)
      object(body.index)
      check(body.state.enabled === true, "enable should turn memory on")
      check(typeof body.index.text === "string", "enable should return index text")
    }),
  http.protected
    .post("/memory/configure", "memory.configure")
    .mutating()
    .seeded(enable)
    .at((ctx) => ({
      path: "/memory/configure",
      headers: ctx.headers(),
      body: { autoConsolidate: false },
    }))
    .json(200, (body) => {
      object(body)
      object(body.state)
      check(body.state.enabled === true, "configure should preserve enabled state")
      check(body.state.autoConsolidate === false, "configure should update auto-save")
    }),
  http.protected
    .post("/memory/rebuild", "memory.rebuild")
    .mutating()
    .seeded(enable)
    .json(200, (body) => {
      object(body)
      object(body.state)
      object(body.index)
      check(body.state.enabled === true, "rebuild should preserve enabled state")
    }),
  http.protected
    .post("/memory/remember", "memory.remember")
    .mutating()
    .seeded(enable)
    .at((ctx) => ({
      path: "/memory/remember",
      headers: ctx.headers(),
      body: { key: "httpapi_memory", text: "Use the HTTP API memory scenario as a stable test fact." },
    }))
    .json(200, (body) => {
      object(body)
      object(body.index)
      check(body.operationCount === 1, "remember should apply one operation")
      check(String(body.index.text).includes("httpapi_memory"), "remember should update the index")
    }),
  http.protected
    .post("/memory/correct", "memory.correct")
    .mutating()
    .seeded(enable)
    .at((ctx) => ({
      path: "/memory/correct",
      headers: ctx.headers(),
      body: { key: "httpapi_correction", text: "Prefer correction memory when a prior fact is wrong." },
    }))
    .json(200, (body) => {
      object(body)
      object(body.index)
      check(body.operationCount === 1, "correction should apply one operation")
      check(String(body.index.text).includes("httpapi_correction"), "correction should update the index")
    }),
  http.protected
    .post("/memory/forget", "memory.forget")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const root = memory(ctx)
        yield* enable(ctx)
        yield* Effect.promise(() =>
          KiloMemory.apply({
            root,
            ops: [{ action: "add", key: "httpapi_forget", text: "This fact should be removed by the route." }],
          }),
        )
        return root
      }),
    )
    .at((ctx) => ({ path: "/memory/forget", headers: ctx.headers(), body: { query: "httpapi_forget" } }))
    .json(200, (body) => {
      object(body)
      object(body.index)
      check(body.removed === 1, "forget should remove one matching line")
      check(!String(body.index.text).includes("httpapi_forget"), "forget should rebuild without the removed fact")
    }),
  http.protected
    .post("/memory/purge", "memory.purge")
    .mutating()
    .seeded(enable)
    .at((ctx) => ({
      path: "/memory/purge",
      headers: ctx.headers(),
      body: { confirm: true },
    }))
    .json(200, (body) => {
      object(body)
      check(body.purged === true, "purge should remove the memory root")
    }),
  http.protected
    .get("/memory/show", "memory.show")
    .seeded((ctx) =>
      Effect.gen(function* () {
        yield* enable(ctx)
        yield* Effect.promise(() =>
          KiloMemory.apply({
            root: memory(ctx),
            ops: [{ action: "add", key: "httpapi_show", text: "Show should expose persisted memory." }],
          }),
        )
      }),
    )
    .json(200, (body) => {
      object(body)
      object(body.sources)
      check(String(body.index).includes("httpapi_show"), "show should include generated index")
      check(String(body.items).includes("httpapi_show"), "show should include generated items")
      check(String(body.sources.project).includes("httpapi_show"), "show should include source memory")
    }),
  http.protected
    .post("/memory/disable", "memory.disable")
    .mutating()
    .seeded(enable)
    .json(200, (body) => {
      object(body)
      object(body.state)
      check(body.state.enabled === false, "disable should turn memory off")
    }),
  http.protected.get("/kilo/profile", "kilo.profile").probe({ path: "/path" }).status(401),
  http.protected.get("/kilo/auth-status", "kilo.authStatus").json(200, (body) => {
    object(body)
    check(body.authenticated === false, "Kilo auth status should report signed out")
    check(body.type === undefined, "Kilo auth status should not expose a credential type while signed out")
  }),
  http.protected.get("/kilo/modes", "kilo.modes").json(200, (body) => {
    object(body)
    array(body.modes)
  }),
  http.protected
    .post("/kilo/fim", "kilo.fim")
    .at((ctx) => ({ path: "/kilo/fim", headers: ctx.headers(), body: { prefix: "const value = ", suffix: "\n" } }))
    .status(401),
  http.protected
    .post("/kilo/edit", "kilo.edit")
    .at((ctx) => ({ path: "/kilo/edit", headers: ctx.headers(), body: edit }))
    .status(401),
  http.protected
    .post("/kilo/audio/transcriptions", "kilo.audio.transcriptions")
    .at((ctx) => ({
      path: "/kilo/audio/transcriptions",
      headers: ctx.headers(),
      body: { model: "whisper-1", input_audio: { data: "", format: "wav" } },
    }))
    .status(401),
  http.protected.get("/kilo/notifications", "kilo.notifications").json(200, array),
  http.protected
    .post("/kilo/organization", "kilo.organization.set")
    .at((ctx) => ({ path: "/kilo/organization", headers: ctx.headers(), body: { organizationId: null } }))
    .status(401),
  http.protected.get("/kilo/claw/status", "kilo.claw.status").probe({ path: "/path" }).status(401),
  http.protected.get("/kilo/claw/chat-credentials", "kilo.claw.chatCredentials").probe({ path: "/path" }).status(401),
  http.protected.get("/kilo/cloud-sessions", "kilo.cloudSessions").probe({ path: "/path" }).status(401),
  http.protected
    .get("/kilo/cloud/session/{id}", "kilo.cloud.session.get")
    .probe({ path: "/path" })
    .at((ctx) => ({ path: route("/kilo/cloud/session/{id}", { id: "httpapi-missing" }), headers: ctx.headers() }))
    .status(401),
  http.protected
    .post("/kilo/cloud/session/import", "kilo.cloud.session.import")
    .at((ctx) => ({ path: "/kilo/cloud/session/import", headers: ctx.headers(), body: { sessionId: "missing" } }))
    .status(401),
  http.protected.get("/network", "network.list").json(200, array),
  http.protected
    .post("/network/{requestID}/reply", "network.reply")
    .at((ctx) => ({
      path: route("/network/{requestID}/reply", { requestID: "que_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => check(body === true, "missing network reply should remain a no-op success")),
  http.protected
    .post("/network/{requestID}/reject", "network.reject")
    .at((ctx) => ({
      path: route("/network/{requestID}/reject", { requestID: "que_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => check(body === true, "missing network reject should remain a no-op success")),
  http.protected.get("/sandbox/support", "sandbox.support").json(200, (body) => {
    object(body)
    check(typeof body.available === "boolean", "sandbox support should report backend availability")
  }),
  http.protected
    .get("/session/{sessionID}/sandbox", "sandbox.status")
    .seeded((ctx) => ctx.session({ title: "Sandbox status" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}/sandbox", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      object(body)
      check(typeof body.enabled === "boolean", "sandbox status should report enabled state")
      check(typeof body.available === "boolean", "sandbox status should report backend availability")
      check(typeof body.version === "number", "sandbox status should report its revision")
    }),
  http.protected
    .post("/session/{sessionID}/sandbox/toggle", "sandbox.toggle")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Sandbox toggle" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}/sandbox/toggle", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      object(body)
      check(typeof body.enabled === "boolean", "sandbox toggle should report enabled state")
      check(typeof body.available === "boolean", "sandbox toggle should report backend availability")
      check(typeof body.version === "number", "sandbox toggle should report its revision")
    }),
  http.protected.get("/remote/status", "remote.status").json(200, (body) => {
    object(body)
    check(body.enabled === false && body.connected === false, "remote should start disabled")
  }),
  http.protected.post("/remote/disable", "remote.disable").json(200, (body) => {
    object(body)
    check(body.enabled === false && body.connected === false, "remote disable should report disconnected state")
  }),
  http.protected
    .post("/remote/enable", "remote.enable")
    .probe({ path: "/path" })
    .json(200, (body) => {
      object(body)
      check(body.enabled === false && body.connected === false, "disabled ingest should keep remote disconnected")
    }),
  http.protected.get("/suggestion", "suggestion.list").json(200, array),
  http.protected
    .post("/suggestion/{requestID}/accept", "suggestion.accept")
    .at((ctx) => ({
      path: route("/suggestion/{requestID}/accept", { requestID: "sug_httpapi_missing" }),
      headers: ctx.headers(),
      body: { index: 0 },
    }))
    .status(404),
  http.protected
    .post("/suggestion/{requestID}/dismiss", "suggestion.dismiss")
    .at((ctx) => ({
      path: route("/suggestion/{requestID}/dismiss", { requestID: "sug_httpapi_missing" }),
      headers: ctx.headers(),
    }))
    .status(404),
  http.protected
    .post("/commit-message", "commitMessage.generate")
    .at((ctx) => ({ path: "/commit-message", headers: ctx.headers(), body: {} }))
    .status(400),
  http.protected
    .post("/commit-message", "commitMessage.generate")
    .at((ctx) => ({ path: "/commit-message", headers: ctx.headers(), body: { path: directory(ctx) } }))
    .json(422, (body) => {
      object(body)
      check(
        body.message === "No changes found to generate a commit message for",
        "no changes should surface a real 422 message, not a masked 500",
      )
    }),
  http.protected
    .post("/session/{sessionID}/branch-name", "branchName.generate")
    .at((ctx) => ({
      path: route("/session/{sessionID}/branch-name", { sessionID: "ses_httpapi_missing" }),
      headers: ctx.headers(),
      body: {},
    }))
    .status(400),
  http.protected
    .post("/enhance-prompt", "enhancePrompt.enhance")
    .at((ctx) => ({ path: "/enhance-prompt", headers: ctx.headers(), body: { text: "" } }))
    .status(400),
  http.protected
    .get("/session/{sessionID}/model-usage", "kilocode.sessionModelUsage")
    .seeded((ctx) => ctx.session({ title: "Model usage" }))
    .at((ctx) => ({
      path: route("/session/{sessionID}/model-usage", { sessionID: ctx.state.id }),
      headers: ctx.headers(),
    }))
    .json(200, (body) => {
      object(body)
      array(body.models)
      object(body.totals)
      check(body.models.length === 0, "a new session should have no model usage")
    }),
  http.protected
    .post("/kilocode/heap/snapshot", "kilocode.heap.snapshot")
    .mutating()
    .jsonEffect(200, (body) =>
      Effect.gen(function* () {
        check(typeof body === "string", "heap snapshot should return its file path")
        yield* Effect.promise(() => rm(body, { force: true }))
      }),
    ),
  http.protected
    .get("/kilocode/agent/requirements", "kilocode.agentRequirements")
    .at((ctx) => ({ path: "/kilocode/agent/requirements?agent=httpapi-agent", headers: ctx.headers() }))
    .json(200, (body, ctx) => {
      object(body)
      check(body.agent === "httpapi-agent", "agent requirements should echo the requested agent")
      check(body.directory === ctx.directory, "agent requirements should use the routed workspace directory")
      check(body.enabled === false, "agent requirements should report disabled when the experiment is off")
      check(body.state === "disabled", "agent requirements should return the disabled state")
      array(body.skills)
      array(body.mcps)
      array(body.vscode_extensions)
    }),
  http.protected
    .post("/kilocode/skill/remove", "kilocode.removeSkill")
    .mutating()
    .preserveDatabase()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const location = yield* file(
          ctx,
          ".kilo/skill/httpapi-remove/SKILL.md",
          "---\nname: httpapi-remove\ndescription: HTTP API removal fixture.\n---\n# HTTP API remove\n",
        )
        const sentinel = yield* file(ctx, ".kilo/skill/httpapi-remove/KEEP.txt", "synthetic sentinel\n")
        return { location, sentinel }
      }),
    )
    .at((ctx) => ({
      path: "/kilocode/skill/remove",
      headers: ctx.headers(),
      body: { location: ctx.state.location },
    }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        check(body === true, "skill removal should return true")
        check(
          !(yield* Effect.promise(() => Bun.file(ctx.state.location).exists())),
          "removed skill should not remain on disk",
        )
        check(
          yield* Effect.promise(() => Bun.file(ctx.state.sentinel).exists()),
          "skill removal should preserve sibling files",
        )
      }),
    ),
  http.protected
    .post("/kilocode/agent/remove", "kilocode.removeAgent")
    .mutating()
    .seeded((ctx) => file(ctx, ".kilo/agent/httpapi-remove.md", "---\ndescription: HTTP API remove\n---\nRemove me.\n"))
    .at((ctx) => ({ path: "/kilocode/agent/remove", headers: ctx.headers(), body: { name: "httpapi-remove" } }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        check(body === true, "agent removal should return true")
        check(!(yield* Effect.promise(() => Bun.file(ctx.state).exists())), "removed agent should not remain on disk")
      }),
    ),
  http.protected
    .post("/kilocode/agent/remove", "kilocode.removeAgent")
    .at((ctx) => ({ path: "/kilocode/agent/remove", headers: ctx.headers(), body: { name: "httpapi-missing" } }))
    .status(400),
  http.protected
    .post("/kilocode/session-import/project", "kilocode.sessionImport.project")
    .mutating()
    .at((ctx) => ({
      path: "/kilocode/session-import/project",
      headers: ctx.headers(),
      body: {
        id: "prj_httpapi_import",
        worktree: directory(ctx),
        timeCreated: 0,
        timeUpdated: 0,
        sandboxes: [],
      },
    }))
    .json(200, (body) => {
      object(body)
      check(body.ok === true && typeof body.id === "string", "project import should return the resolved project")
    }),
  http.protected
    .post("/kilocode/session-import/session", "kilocode.sessionImport.session")
    .mutating()
    .seeded((ctx) => ctx.project())
    .at((ctx) => ({
      path: "/kilocode/session-import/session",
      headers: ctx.headers(),
      body: {
        id: "ses_httpapi_import",
        projectID: ctx.state.id,
        slug: "httpapi-import",
        directory: directory(ctx),
        title: "HTTP API import",
        version: "httpapi",
        timeCreated: 0,
        timeUpdated: 0,
      },
    }))
    .json(200, (body) => {
      object(body)
      check(body.ok === true && body.id === "ses_httpapi_import", "session import should return imported ID")
    }),
  http.protected
    .post("/kilocode/session-import/message", "kilocode.sessionImport.message")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Import message" }))
    .at((ctx) => ({
      path: "/kilocode/session-import/message",
      headers: ctx.headers(),
      body: {
        id: "msg_httpapi_import",
        sessionID: ctx.state.id,
        timeCreated: 0,
        data: {
          role: "user",
          time: { created: 0 },
          agent: "code",
          model: { providerID: "test", modelID: "test" },
        },
      },
    }))
    .json(200, (body) => {
      object(body)
      check(body.ok === true && body.id === "msg_httpapi_import", "message import should return imported ID")
    }),
  http.protected
    .post("/kilocode/session-import/part", "kilocode.sessionImport.part")
    .mutating()
    .seeded((ctx) =>
      Effect.gen(function* () {
        const session = yield* ctx.session({ title: "Import part" })
        const message = yield* ctx.message(session.id)
        return { session, message }
      }),
    )
    .at((ctx) => ({
      path: "/kilocode/session-import/part",
      headers: ctx.headers(),
      body: {
        id: "prt_httpapi_import",
        messageID: ctx.state.message.info.id,
        sessionID: ctx.state.session.id,
        timeCreated: 0,
        data: { type: "text", text: "imported part" },
      },
    }))
    .json(200, (body) => {
      object(body)
      check(body.ok === true && body.id === "prt_httpapi_import", "part import should return imported ID")
    }),
  http.protected
    .post("/permission/{requestID}/always-rules", "permission.saveAlwaysRules")
    .at((ctx) => ({
      path: route("/permission/{requestID}/always-rules", { requestID: "per_httpapi_missing" }),
      headers: ctx.headers(),
      body: {},
    }))
    .status(404),
  http.protected
    .post("/permission/allow-everything", "permission.allowEverything")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Allow everything" }))
    .at((ctx) => ({
      path: "/permission/allow-everything",
      headers: ctx.headers(),
      body: { enable: true, sessionID: ctx.state.id },
    }))
    .status(401),
  http.protected
    .post("/session/viewed", "session.viewed")
    .at((ctx) => ({ path: "/session/viewed", headers: ctx.headers(), body: { focused: [], open: [] } }))
    .json(200, (body) => check(body === true, "session viewed should return true")),
  http.protected
    .post("/telemetry/capture", "telemetry.capture")
    .at((ctx) => ({
      path: "/telemetry/capture",
      headers: ctx.headers(),
      body: { event: "httpapi_exercise", properties: { source: "httpapi" } },
    }))
    .json(200, (body) => check(body === true, "telemetry capture should return true")),
  http.protected
    .post("/telemetry/setEnabled", "telemetry.setEnabled")
    .at((ctx) => ({ path: "/telemetry/setEnabled", headers: ctx.headers(), body: { enabled: true } }))
    .json(200, (body) => check(body === true, "telemetry enabled update should return true")),
  http.protected
    .post("/instance/reload", "instance.reload")
    .mutating()
    .seeded((ctx) => ctx.session({ title: "Reload" }))
    .at((ctx) => ({
      path: `/instance/reload?directory=${encodeURIComponent(directory(ctx))}`,
      headers: ctx.headers(),
      body: {},
    }))
    .json(200, (body) => check(body === true, "instance reload should return true")),
]
