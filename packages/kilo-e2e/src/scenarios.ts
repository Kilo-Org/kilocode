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
}

export function manifest(id: ScenarioID, lane: (typeof LANES)[number]): ScenarioManifest {
  const definition = DEFINITIONS[id]
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

export const ALL_MANIFESTS = SCENARIO_IDS.flatMap((id) => LANES.map((lane) => manifest(id, lane)))
