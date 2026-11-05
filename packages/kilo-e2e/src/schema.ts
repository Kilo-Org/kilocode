import z from "zod"

export const SCHEMA_VERSION = 1

export const Lane = z.enum(["local", "cloud"])
export type Lane = z.infer<typeof Lane>

export const ScenarioID = z.enum(["session.open", "prompt.stream", "permission.continue"])
export type ScenarioID = z.infer<typeof ScenarioID>

export const Capability = z.enum(["transcript.read", "stream.observe", "permission.answer"])
export type Capability = z.infer<typeof Capability>

export const PromptDirective = z.enum(["open", "stream", "permission"])
export type PromptDirective = z.infer<typeof PromptDirective>

export const Scalar = z.union([z.string(), z.number(), z.boolean(), z.null()])
export type Scalar = z.infer<typeof Scalar>

export const Resource = z.object({
  kind: z.string().min(1),
  id: z.string().min(1),
})
export type Resource = z.infer<typeof Resource>

export const Artifacts = z.object({
  logs: z.array(z.string().min(1)),
  screenshots: z.array(z.string().min(1)),
  snapshots: z.array(z.string().min(1)),
})
export type Artifacts = z.infer<typeof Artifacts>

export const Assertion = z.object({
  name: z.string().min(1),
  status: z.enum(["passed", "failed", "skipped"]),
  detail: z.string().optional(),
})
export type Assertion = z.infer<typeof Assertion>

export const Origins = z.object({
  web: z.url(),
  cloudAgent: z.url(),
  sessionIngest: z.url().optional(),
  events: z.url().optional(),
  gateway: z.url().optional(),
  fakeLlm: z.url(),
})
export type Origins = z.infer<typeof Origins>

export const StateDirs = z.object({
  data: z.string().min(1),
  config: z.string().min(1),
  state: z.string().min(1),
  cache: z.string().min(1),
})
export type StateDirs = z.infer<typeof StateDirs>

export const FixtureDescriptor = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  runId: z.string().min(1),
  lane: Lane,
  createdAt: z.iso.datetime(),
  fakeLlmScope: z.string().min(1),
  origins: Origins,
  credentials: z.object({
    apiKey: z.string().min(1),
    orgId: z.string().min(1).optional(),
  }),
  project: z.object({
    fixture: z.literal("deterministic-git"),
    gitUrl: z.string().min(1),
    branch: z.string().min(1),
    model: z.string().min(1),
    seed: z.string().min(1),
  }),
  resources: z.object({
    profileId: z.string().min(1).optional(),
    workspaceId: z.string().min(1).optional(),
    cloudSessionId: z.string().min(1).optional(),
    nativeSessionId: z.string().min(1).optional(),
  }),
  cleanup: z.object({
    token: z.string().min(1),
    ids: z.array(Resource),
  }),
  state: StateDirs,
})
export type FixtureDescriptor = z.infer<typeof FixtureDescriptor>

export const ScenarioManifest = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: ScenarioID,
  lane: Lane,
  prompt: z.object({
    directive: PromptDirective,
    token: z.string().min(1),
  }),
  expected: z.object({
    ui: z.array(z.string().min(1)),
    model: z.array(z.string().min(1)),
    terminalTranscriptToken: z.string().min(1),
  }),
  requires: z.array(Capability),
  timeoutMs: z.number().int().positive(),
})
export type ScenarioManifest = z.infer<typeof ScenarioManifest>

export const ProviderPrepareRequest = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  operation: z.literal("prepare"),
  runId: z.string().min(1),
  lane: Lane,
  fakeLlmScope: z.string().min(1),
  descriptorPath: z.string().min(1),
  projectDir: z.string().min(1),
  state: StateDirs,
})
export type ProviderPrepareRequest = z.infer<typeof ProviderPrepareRequest>

export const ProviderCleanupRequest = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  operation: z.literal("cleanup"),
  runId: z.string().min(1),
  descriptorPath: z.string().min(1),
  descriptorPresent: z.boolean(),
})
export type ProviderCleanupRequest = z.infer<typeof ProviderCleanupRequest>

export const ProviderRequest = z.discriminatedUnion("operation", [ProviderPrepareRequest, ProviderCleanupRequest])
export type ProviderRequest = z.infer<typeof ProviderRequest>

export const ProviderPrepareResult = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  operation: z.literal("prepare"),
  runId: z.string().min(1),
  descriptorPath: z.string().min(1),
  provider: z.object({
    id: z.string().min(1),
    version: z.string().min(1),
  }),
})
export type ProviderPrepareResult = z.infer<typeof ProviderPrepareResult>

export const CleanupResult = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  runId: z.string().min(1),
  status: z.enum(["clean", "failed"]),
  removed: z.array(Resource),
  leftovers: z.array(
    z.object({
      kind: z.string().min(1),
      id: z.string().min(1),
      reason: z.string().min(1),
    }),
  ),
  error: z.string().optional(),
})
export type CleanupResult = z.infer<typeof CleanupResult>

export const DriverRequest = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  runId: z.string().min(1),
  runDir: z.string().min(1),
  descriptorPath: z.string().min(1),
  artifactsDir: z.string().min(1),
  scenario: ScenarioManifest,
  project: z.object({
    path: z.string().min(1),
    branch: z.string().min(1),
    commit: z.string().min(1),
  }),
})
export type DriverRequest = z.infer<typeof DriverRequest>

export const DriverResult = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  runId: z.string().min(1),
  scenarioId: ScenarioID,
  lane: Lane,
  driver: z.object({
    id: z.string().min(1),
    version: z.string().min(1),
  }),
  ide: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
  }),
  provenance: z.object({
    clientHash: z.string().min(1).nullable(),
    cliHash: z.string().min(1).nullable(),
  }),
  capabilities: z.array(Capability),
  outcome: z.enum(["passed", "failed"]),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  assertions: z.array(Assertion),
  lastState: z.record(z.string(), Scalar),
  artifacts: Artifacts,
})
export type DriverResult = z.infer<typeof DriverResult>

export const Provenance = z.object({
  kiloCommit: z.string().min(1).nullable(),
  cloudCommit: z.string().min(1).nullable(),
  ide: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
  }),
  clientHash: z.string().min(1).nullable(),
  cliHash: z.string().min(1).nullable(),
  fixtureSchemaVersion: z.literal(SCHEMA_VERSION),
})
export type Provenance = z.infer<typeof Provenance>

export const EvidenceReport = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  runId: z.string().min(1),
  scenarioId: ScenarioID,
  lane: Lane,
  provenance: Provenance,
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  outcome: z.enum(["passed", "failed", "cancelled"]),
  assertions: z.array(Assertion),
  lastState: z.record(z.string(), Scalar),
  artifacts: Artifacts,
  cleanup: CleanupResult,
  failure: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
    })
    .optional(),
})
export type EvidenceReport = z.infer<typeof EvidenceReport>

export const SCHEMA_DOCUMENTS = {
  "fixture-descriptor": FixtureDescriptor,
  "scenario-manifest": ScenarioManifest,
  "provider-request": ProviderRequest,
  "provider-prepare-result": ProviderPrepareResult,
  "driver-request": DriverRequest,
  "driver-result": DriverResult,
  "cleanup-result": CleanupResult,
  "evidence-report": EvidenceReport,
} as const

export type SchemaName = keyof typeof SCHEMA_DOCUMENTS

export function jsonSchema(name: SchemaName) {
  return z.toJSONSchema(SCHEMA_DOCUMENTS[name], { io: "input", target: "draft-2020-12" })
}

export function jsonSchemaDocuments() {
  return Object.fromEntries(Object.keys(SCHEMA_DOCUMENTS).map((name) => [name, jsonSchema(name as SchemaName)]))
}
