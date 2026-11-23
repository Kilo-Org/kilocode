import { CleanupResult, FixtureDescriptor, ProviderPrepareResult, ProviderRequest, SCHEMA_VERSION } from "../src/schema"
import { readJsonAs, writeJson } from "../src/protocol"
import { args } from "./cli"

export type ProviderMode = "clean" | "cleanup-fail" | "cleanup-crash" | "noop" | "prepare-fail" | "bad-origin"

const ORIGINS = {
  web: "http://127.0.0.1:43100",
  cloudAgent: "http://127.0.0.1:43101",
  sessionIngest: "http://127.0.0.1:43102",
  events: "ws://127.0.0.1:43103",
  gateway: "http://127.0.0.1:43104",
  fakeLlm: "http://127.0.0.1:43105",
}

export type PrepareMode = "bad-prepare"

export async function provider(mode: ProviderMode, prepareMode?: PrepareMode) {
  const { request: requestPath, result: resultPath } = args()
  const request = await readJsonAs(requestPath, ProviderRequest)

  if (request.operation === "prepare") {
    if (mode === "prepare-fail") process.exit(1)
    const owned =
      mode === "noop"
        ? []
        : [
            { kind: "workspace", id: `ws-${request.runId}` },
            { kind: "cloud-session", id: `cs-${request.runId}` },
          ]
    const descriptor: FixtureDescriptor = {
      schemaVersion: SCHEMA_VERSION,
      runId: request.runId,
      lane: request.lane,
      createdAt: new Date().toISOString(),
      fakeLlmScope: request.fakeLlmScope,
      origins: mode === "bad-origin" ? { ...ORIGINS, web: "https://api.kilo.ai" } : ORIGINS,
      credentials: { apiKey: `fake-key-${request.runId}`, orgId: "org-fake" },
      project: {
        fixture: "deterministic-git",
        gitUrl: `file://${request.projectDir}`,
        branch: "main",
        model: "kilo/fake-deterministic",
        seed: "kilo-e2e",
      },
      resources:
        request.lane === "cloud"
          ? {
              profileId: `profile-${request.runId}`,
              workspaceId: `ws-${request.runId}`,
              cloudSessionId: `cs-${request.runId}`,
              nativeSessionId: `ns-${request.runId}`,
            }
          : {},
      cleanup: { token: `cleanup-${request.runId}`, ids: owned },
      state: request.state,
    }
    await writeJson(request.descriptorPath, descriptor)
    if (prepareMode === "bad-prepare") {
      await writeJson(
        resultPath,
        ProviderPrepareResult.parse({
          schemaVersion: SCHEMA_VERSION,
          operation: "prepare",
          runId: request.runId,
          descriptorPath: `${request.descriptorPath}.elsewhere`,
          provider: { id: "fake-provider-bad-prepare", version: "0.0.0" },
        }),
      )
      return
    }
    await writeJson(
      resultPath,
      ProviderPrepareResult.parse({
        schemaVersion: SCHEMA_VERSION,
        operation: "prepare",
        runId: request.runId,
        descriptorPath: request.descriptorPath,
        provider: { id: `fake-provider-${mode}`, version: "0.0.0" },
      }),
    )
    return
  }

  if (!request.descriptorPresent) {
    await writeJson(
      resultPath,
      CleanupResult.parse({
        schemaVersion: SCHEMA_VERSION,
        runId: request.runId,
        status: "clean",
        removed: [],
        leftovers: [],
      }),
    )
    return
  }

  const descriptor =
    prepareMode === "bad-prepare" ? undefined : await readJsonAs(request.descriptorPath, FixtureDescriptor)
  if (mode === "cleanup-crash") process.exit(1)
  if (mode === "cleanup-fail") {
    await writeJson(
      resultPath,
      CleanupResult.parse({
        schemaVersion: SCHEMA_VERSION,
        runId: request.runId,
        status: "failed",
        removed: prepareMode === "bad-prepare" ? [{ kind: "workspace", id: `ws-${request.runId}` }] : [],
        leftovers: (descriptor?.cleanup.ids ?? []).map((resource) => ({
          kind: resource.kind,
          id: resource.id,
          reason: "owned resource could not be removed",
        })),
        error: prepareMode === "bad-prepare" ? "" : "fake cleanup failure",
      }),
    )
    return
  }

  await writeJson(
    resultPath,
    CleanupResult.parse({
      schemaVersion: SCHEMA_VERSION,
      runId: request.runId,
      status: "clean",
      removed: descriptor?.cleanup.ids ?? [],
      leftovers: [],
    }),
  )
}
