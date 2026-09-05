import { mkdir } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"

const sourceRoot = process.env.KILOCODE_V1_CHECKOUT
const databasePath = process.env.KILO_DB
const projectDirectory = process.env.KILO_V1_FIXTURE_PROJECT
const manifestPath = process.env.KILO_V1_FIXTURE_MANIFEST

if (!sourceRoot || !databasePath || !projectDirectory || !manifestPath) {
  throw new Error("KILOCODE_V1_CHECKOUT, KILO_DB, KILO_V1_FIXTURE_PROJECT, and KILO_V1_FIXTURE_MANIFEST are required")
}

await mkdir(projectDirectory, { recursive: true })

const source = (relative: string) => pathToFileURL(path.join(sourceRoot, relative)).href

// Load Effect from the V1 checkout. The V1 and V2 worktrees intentionally pin
// different Effect releases, so sharing the V2 copy would create incompatible
// service contexts at runtime.
const { Effect } = await import(source("packages/opencode/node_modules/effect/dist/index.js"))
const { AppNodeBuilder } = await import(source("packages/core/src/effect/app-node-builder.ts"))
const { LayerNode } = await import(source("packages/core/src/effect/layer-node.ts"))
const { EventV2Bridge } = await import(source("packages/opencode/src/event-v2-bridge.ts"))
const { RuntimeFlags } = await import(source("packages/opencode/src/effect/runtime-flags.ts"))
const sessionModule = await import(source("packages/opencode/src/session/session.ts"))
const Session = sessionModule.Session
const { SessionProjector } = await import(source("packages/core/src/session/projector.ts"))
const { InstanceRef } = await import(source("packages/opencode/src/effect/instance-ref.ts"))

const model = {
  providerID: "fixture-provider",
  id: "fixture-model",
  variant: "fixture-variant",
}

const diff = {
  file: "fixture.ts",
  patch: "@@ -0,0 +1 @@\n+fixture\n",
  before: "",
  after: "fixture\n",
  additions: 1,
  deletions: 0,
  status: "modified",
}

const project = {
  id: "prj_v1_writer_fixture",
  worktree: projectDirectory,
  vcs: undefined,
  name: "V1 writer fixture",
  time: { created: 1, updated: 1 },
  sandboxes: [],
}

const instance = {
  directory: projectDirectory,
  worktree: projectDirectory,
  project,
}

const runtime = AppNodeBuilder.build(LayerNode.group([Session.node, EventV2Bridge.node, SessionProjector.node]), [
  [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false, disableDefaultPlugins: true })],
])

const result = await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const session = yield* Session.Service
      const info = yield* session.create({ title: "Actual V1 writer fixture", agent: "build", model })

      yield* session.setSummary({
        sessionID: info.id,
        summary: { additions: 1, deletions: 0, files: 1, diffs: [diff] },
      })

      const userID = "msg_fixture_user"
      yield* session.updateMessage({
        id: userID,
        sessionID: info.id,
        role: "user",
        time: { created: 10 },
        agent: "build",
        model: { providerID: model.providerID, modelID: model.id, variant: model.variant },
        system: "fixture system context",
        tools: { bash: true },
        editorContext: {
          directory: projectDirectory,
          worktree: projectDirectory,
          visibleFiles: ["fixture.ts"],
          openTabs: ["fixture.ts"],
          activeFile: "fixture.ts",
          shell: "zsh",
        },
        summary: { title: "fixture summary", body: "fixture body", diffs: [diff] },
      })
      yield* session.updatePart({
        id: "prt_fixture_user_text",
        messageID: userID,
        sessionID: info.id,
        type: "text",
        text: "hello from the actual V1 writer",
        time: { start: 10, end: 11 },
        metadata: { origin: "fixture" },
      })

      const assistantID = "msg_fixture_assistant"
      yield* session.updateMessage({
        id: assistantID,
        sessionID: info.id,
        role: "assistant",
        time: { created: 20, completed: 25 },
        parentID: userID,
        modelID: model.id,
        providerID: model.providerID,
        mode: "build",
        agent: "build",
        path: { cwd: projectDirectory, root: projectDirectory },
        cost: 0.5,
        tokens: { total: 17, input: 2, output: 3, reasoning: 4, cache: { read: 5, write: 6 } },
        structured: { fixture: true },
        variant: model.variant,
        finish: "end_turn",
      })
      yield* session.updatePart({
        id: "prt_fixture_assistant_text",
        messageID: assistantID,
        sessionID: info.id,
        type: "text",
        text: "assistant response from the actual V1 writer",
        time: { start: 20, end: 21 },
      })
      yield* session.updatePart({
        id: "prt_fixture_tool",
        messageID: assistantID,
        sessionID: info.id,
        type: "tool",
        callID: "call_fixture",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "printf fixture", description: "fixture command" },
          output: "fixture\n",
          title: "fixture command",
          metadata: { origin: "fixture" },
          time: { start: 22, end: 23 },
        },
      })
      yield* session.updatePart({
        id: "prt_fixture_step_finish",
        messageID: assistantID,
        sessionID: info.id,
        type: "step-finish",
        reason: "stop",
        model: { providerID: model.providerID, modelID: model.id },
        generationID: "generation_fixture",
        vercelID: "vercel_fixture",
        metrics: { prompt: 101, generation: 202, source: "provider" },
        time: { start: 20, end: 25, elapsed: 5 },
        cost: 0.5,
        tokens: { total: 17, input: 2, output: 3, reasoning: 4, cache: { read: 5, write: 6 } },
      })

      const compactionID = "msg_fixture_compaction"
      yield* session.updateMessage({
        id: compactionID,
        sessionID: info.id,
        role: "user",
        time: { created: 30 },
        agent: "build",
        model: { providerID: model.providerID, modelID: model.id, variant: model.variant },
      })
      yield* session.updatePart({
        id: "prt_fixture_compaction",
        messageID: compactionID,
        sessionID: info.id,
        type: "compaction",
        auto: true,
        tail_start_id: userID,
      })

      const summaryID = "msg_fixture_summary"
      yield* session.updateMessage({
        id: summaryID,
        sessionID: info.id,
        role: "assistant",
        time: { created: 31, completed: 32 },
        parentID: compactionID,
        modelID: model.id,
        providerID: model.providerID,
        mode: "build",
        agent: "build",
        path: { cwd: projectDirectory, root: projectDirectory },
        summary: true,
        cost: 0.25,
        tokens: { total: 7, input: 1, output: 2, reasoning: 1, cache: { read: 2, write: 1 } },
        finish: "end_turn",
      })
      yield* session.updatePart({
        id: "prt_fixture_summary_text",
        messageID: summaryID,
        sessionID: info.id,
        type: "text",
        text: "compaction summary from the actual V1 writer",
      })

      return { sessionID: info.id, userID, assistantID, compactionID, summaryID }
    }).pipe(Effect.provideService(InstanceRef, instance), Effect.provide(runtime)),
  ),
)

await Bun.write(manifestPath, JSON.stringify(result))
