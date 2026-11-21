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

/**
 * The model that will read the attachments of this submit, or undefined when the guard
 * does not apply. Shell mode sends only the command, so it has no receiver. Slash commands
 * are routed by the server (command model, command agent, subtask handling), so they are
 * not checked. A subagent steer runs on the child session's own model. Any other prompt
 * uses the selected model.
 */
export function receivingModel(input: {
  mode: string
  session: Parameters<typeof KiloSteer.prompt>[0]
  selected: ModelRef
  slash: boolean
}): ModelRef | undefined {
  if (input.slash) return undefined
  const steering = KiloSteer.steering(input.session)
  if (input.mode === "shell" && !steering) return undefined
  const steered = steering ? input.session?.model : undefined
  if (steered) return { providerID: steered.providerID, modelID: steered.id }
  return input.selected
}
