import { Lane, SCHEMA_VERSION, ScenarioID, ScenarioManifest, type Capability, type PromptDirective } from "./schema"

const SELECTOR_KEYS = new Set([
  "selector",
  "selectors",
  "cssselector",
  "xpath",
  "swing",
  "swingselector",
  "dom",
  "domselector",
  "locator",
  "locators",
  "componenttree",
  "accessibilityid",
])

const SELECTOR_VALUES = /^(?:[#.]\S+|\/\/\S+|xpath=|css=|accessibilityId=)/i

export class ManifestError extends Error {}

function norm(key: string) {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "")
}

function scan(value: unknown, where: string): void {
  if (typeof value === "string") {
    if (SELECTOR_VALUES.test(value)) throw new ManifestError(`selector-like value at ${where}`)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scan(item, `${where}[${index}]`))
    return
  }
  if (!value || typeof value !== "object") return
  for (const [key, child] of Object.entries(value)) {
    if (SELECTOR_KEYS.has(norm(key))) throw new ManifestError(`selector-like field at ${where}.${key}`)
    scan(child, `${where}.${key}`)
  }
}

export function assertSelectorFree(input: unknown): void {
  scan(input, "$")
}

export function validateManifest(input: unknown): ScenarioManifest {
  assertSelectorFree(input)
  const parsed = ScenarioManifest.safeParse(input)
  if (!parsed.success) throw new ManifestError("scenario manifest does not match its schema")
  return parsed.data
}

type Definition = {
  prompt: { directive: PromptDirective; token: string }
  expected: { ui: string[]; model: string[]; terminalTranscriptToken: string }
  requires: Capability[]
  /** Lanes this scenario can run on; every lane when omitted. */
  lanes?: Lane[]
}

export const SCENARIO_IDS = ScenarioID.options
export const LANES = Lane.options

const DEFINITIONS: Record<ScenarioID, Definition> = {
  "session.open": {
    prompt: { directive: "open", token: "K1-SESSION-OPEN" },
    expected: {
      ui: ["transcript.visible"],
      model: ["session.ready"],
      terminalTranscriptToken: "K1-SESSION-OPEN",
    },
    requires: ["transcript.read"],
  },
  "prompt.stream": {
    prompt: { directive: "stream", token: "K1-PROMPT-STREAM" },
    expected: {
      ui: ["assistant.streaming", "assistant.complete"],
      model: ["prompt.completed", "transcript.token"],
      terminalTranscriptToken: "K1-PROMPT-STREAM",
    },
    requires: ["transcript.read", "stream.observe"],
  },
  "permission.continue": {
    prompt: { directive: "permission", token: "K1-PERMISSION-CONTINUE" },
    expected: {
      ui: ["permission.visible", "permission.dismissed", "assistant.complete"],
      model: ["permission.requested", "permission.answered", "turn.completed"],
      terminalTranscriptToken: "K1-PERMISSION-CONTINUE",
    },
    requires: ["transcript.read", "stream.observe", "permission.answer"],
  },
  "settings.telemetry": {
    prompt: { directive: "settings", token: "K1-SETTINGS-TELEMETRY" },
    expected: {
      ui: [
        "settings.advanced.visible",
        "settings.telemetry.toggle",
        "settings.telemetry.persisted",
        "settings.telemetry.reload",
      ],
      model: ["cli.ready"],
      terminalTranscriptToken: "K1-SETTINGS-TELEMETRY",
    },
    requires: [],
  },
  "followup.new-session": {
    prompt: { directive: "followup", token: "K1-FOLLOWUP-NEWSESSION" },
    expected: {
      ui: [
        "question.visible",
        "question.requested",
        "question.answered",
        "followup.adopted",
        "followup.plan.marker",
      ],
      model: ["plan.mode", "session.ready"],
      terminalTranscriptToken: "K1-FOLLOWUP-NEWSESSION",
    },
    requires: ["transcript.read"],
    // The local CLI drives the follow-up flow; the Kotlin driver only asserts it on the local lane.
    lanes: ["local"],
  },
}

/**
 * Whether a scenario runs on a lane. Every consumer that builds a cell goes through [manifest],
 * which enforces this, so no path can produce a cell for an unsupported lane.
 */
export function supportsLane(id: ScenarioID, lane: Lane): boolean {
  const lanes = DEFINITIONS[id].lanes
  return !lanes || lanes.includes(lane)
}

export function manifest(id: ScenarioID, lane: Lane): ScenarioManifest {
  const definition = DEFINITIONS[id]
  if (!supportsLane(id, lane)) {
    const lanes = definition.lanes?.join(", ") ?? LANES.join(", ")
    throw new ManifestError(`${id} does not run on the ${lane} lane; it runs on: ${lanes}`)
  }
  return validateManifest({
    schemaVersion: SCHEMA_VERSION,
    id,
    lane,
    prompt: definition.prompt,
    expected: definition.expected,
    requires: definition.requires,
    timeoutMs: 60_000,
  })
}

export const ALL_MANIFESTS = SCENARIO_IDS.flatMap((id) =>
  LANES.filter((lane) => supportsLane(id, lane)).map((lane) => manifest(id, lane)),
)
