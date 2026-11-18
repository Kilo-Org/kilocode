// kilocode_change - new file
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
  parts: ReadonlyArray<{ type: string; mime?: string; filename?: string }>,
  capabilities: Capabilities | undefined,
): Unsupported[] {
  if (!capabilities) return []
  return parts.flatMap((part) => {
    if (part.type !== "file" || !part.mime) return []
    const modality = modalityOf(part.mime)
    if (!modality || capabilities[modality]) return []
    return [{ filename: part.filename, modality }]
  })
}

type ModelRef = { providerID: string; modelID: string }

/**
 * The model that will read the attachments of this submit, or undefined when none are sent.
 * Shell mode sends only the command, so it has no receiver. A subagent steer runs on the
 * child session's own model, any other prompt or slash command on the selected model.
 */
export function receivingModel(input: {
  mode: string
  session: Parameters<typeof KiloSteer.prompt>[0]
  selected: ModelRef
}): ModelRef | undefined {
  if (input.mode === "shell" && !KiloSteer.steering(input.session)) return undefined
  const steered = KiloSteer.steering(input.session) ? input.session?.model : undefined
  return steered ? { providerID: steered.providerID, modelID: steered.id } : input.selected
}
