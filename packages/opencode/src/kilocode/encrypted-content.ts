// kilocode_change - new file
import type { SharedV2ProviderMetadata } from "@ai-sdk/provider"
import type { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session"

/**
 * Attaches `encrypted_content` from step-level providerMetadata to the
 * reasoning parts created during that step, so it is persisted and can
 * be round-tripped in subsequent requests.
 *
 * Dola Seed 2.0 (and similar) models return an opaque `encrypted_content`
 * blob alongside `reasoning_content` via the openaiCompatible sub-provider.
 * The metadataExtractor in kilo-gateway captures it into
 * `providerMetadata.openaiCompatible.encrypted_content` on the finish event.
 * This helper reads that value and writes it onto each reasoning part's
 * `metadata.openaiCompatible.encrypted_content`.
 *
 * Later, `ProviderTransform.normalizeMessages()` pulls it back out and
 * places it on the message-level `providerOptions.openaiCompatible` so the
 * SDK round-trips it to the API.
 */
export async function persistEncryptedContent(input: {
  metadata: SharedV2ProviderMetadata | undefined
  messageID: string
  ids: Set<string>
}) {
  const encrypted = (input.metadata?.openaiCompatible as Record<string, unknown>)?.encrypted_content as
    | string
    | undefined
  if (!encrypted || input.ids.size === 0) return

  const parts = await MessageV2.parts(input.messageID)
  for (const part of parts) {
    if (part.type !== "reasoning" || !input.ids.has(part.id)) continue
    part.metadata = {
      ...part.metadata,
      openaiCompatible: {
        ...(part.metadata?.openaiCompatible as Record<string, unknown>),
        encrypted_content: encrypted,
      },
    }
    await Session.updatePart(part)
  }
}
