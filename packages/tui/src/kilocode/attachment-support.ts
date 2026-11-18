import { KiloSteer } from "./steer"

export type Modality = "image" | "audio" | "video" | "pdf"

export type Capabilities = Record<Modality, boolean>

export type Unsupported = { filename?: string; modality: Modality }

// Keep in sync with mimeToModality() in packages/opencode/src/provider/transform.ts,
// which is what drops unsupported attachments on the backend.
export function modalityOf(mime: string): Modality | undefined {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("video/")) return "video"
  if (mime === "application/pdf") return "pdf"
  return undefined
}

/**
 * Lists attachments whose modality the selected model cannot read. Missing capabilities
 * (unknown model) count as supported so we never block on incomplete data.
 */
export function unsupportedAttachments(
  parts: ReadonlyArray<{ type: string; mime?: string; filename?: string; source?: unknown }>,
  capabilities: Capabilities | undefined,
): Unsupported[] {
  if (!capabilities) return []
  return parts.flatMap((part) => {
    if (part.type !== "file" || !part.mime) return []
    // MCP resources are read by the server and inlined as text; only binary blobs become
    // attachments, and the advertised mime says nothing about that (e.g. text image/svg+xml).
    if (isResource(part.source)) return []
    const modality = modalityOf(part.mime)
    if (!modality || capabilities[modality]) return []
    return [{ filename: part.filename, modality }]
  })
}

function isResource(source: unknown): boolean {
  return typeof source === "object" && source !== null && "type" in source && source.type === "resource"
}

type ModelRef = { providerID: string; modelID: string }

type CommandRef = { model?: string; agent?: string }
type AgentRef = { name: string; model?: ModelRef }

/**
 * The model that will read the attachments of this submit, or undefined when none are sent.
 * Shell mode sends only the command, so it has no receiver. A subagent steer runs on the
 * child session's own model. A slash command follows the server's order in
 * SessionPrompt.command: command model, then the command agent's model, then the selection.
 * Any other prompt uses the selected model.
 */
export function receivingModel(input: {
  mode: string
  session: Parameters<typeof KiloSteer.prompt>[0]
  selected: ModelRef
  command?: CommandRef
  agents?: ReadonlyArray<AgentRef>
}): ModelRef | undefined {
  const steering = KiloSteer.steering(input.session)
  if (input.mode === "shell" && !steering) return undefined
  const steered = steering ? input.session?.model : undefined
  if (steered) return { providerID: steered.providerID, modelID: steered.id }
  if (!input.command || steering) return input.selected
  if (input.command.model) return parseModel(input.command.model)
  const agent = input.command.agent ? input.agents?.find((item) => item.name === input.command?.agent) : undefined
  return agent?.model ? { providerID: agent.model.providerID, modelID: agent.model.modelID } : input.selected
}

// Same split as Provider.parseModel: the model id may itself contain slashes.
function parseModel(model: string): ModelRef {
  const [providerID, ...rest] = model.split("/")
  return { providerID, modelID: rest.join("/") }
}
