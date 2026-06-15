import { Effect } from "effect"
import { mkdir, rm } from "fs/promises"
import path from "path"
import { array, check, object } from "../../server/httpapi-exercise/assertions"
import { http, route } from "../../server/httpapi-exercise/dsl"
import type { Scenario, ScenarioContext } from "../../server/httpapi-exercise/types"

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
  http.protected.get("/kilo/profile", "kilo.profile").probe({ path: "/path" }).status(401),
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
    .post("/enhance-prompt", "enhancePrompt.enhance")
    .at((ctx) => ({ path: "/enhance-prompt", headers: ctx.headers(), body: { text: "" } }))
    .status(400),
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
    .post("/kilocode/skill/remove", "kilocode.removeSkill")
    .mutating()
    .preserveDatabase()
    .seeded((ctx) => file(ctx, ".opencode/skill/httpapi-remove/SKILL.md", "# HTTP API remove\n"))
    .at((ctx) => ({ path: "/kilocode/skill/remove", headers: ctx.headers(), body: { location: ctx.state } }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        check(body === true, "skill removal should return true")
        check(!(yield* Effect.promise(() => Bun.file(ctx.state).exists())), "removed skill should not remain on disk")
      }),
    ),
  http.protected
    .post("/kilocode/agent/remove", "kilocode.removeAgent")
    .mutating()
    .seeded((ctx) =>
      file(ctx, ".opencode/agent/httpapi-remove.md", "---\ndescription: HTTP API remove\n---\nRemove me.\n"),
    )
    .at((ctx) => ({ path: "/kilocode/agent/remove", headers: ctx.headers(), body: { name: "httpapi-remove" } }))
    .jsonEffect(200, (body, ctx) =>
      Effect.gen(function* () {
        check(body === true, "agent removal should return true")
        check(!(yield* Effect.promise(() => Bun.file(ctx.state).exists())), "removed agent should not remain on disk")
      }),
    ),
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
    .json(200, (body) => check(body === true, "allow everything should return true")),
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
]
