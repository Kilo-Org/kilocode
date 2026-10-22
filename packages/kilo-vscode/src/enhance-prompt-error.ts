/**
 * Convert raw Enhance Prompt provider failures into actionable messages.
 */
export function normalizeEnhancePromptErrorMessage(raw: string): string {
  const base = raw || "Failed to enhance prompt"
  const normalized = base.toLowerCase()

  const looksLikeQuotaError =
    normalized.includes("insufficient_quota") ||
    normalized.includes("insufficient quota") ||
    normalized.includes("exceeded your current quota") ||
    (normalized.includes("quota") && normalized.includes("billing"))

  if (!looksLikeQuotaError) return base

  const details = base === "Failed to enhance prompt" ? "" : ` Provider response: ${base}`
  return (
    "Enhance Prompt failed due to provider quota/billing limits. " +
    "Check your provider account billing/quota and API access, then retry." +
    details
  )
}
