const OPEN = "<subagent-steering>"
const CLOSE = "</subagent-steering>"

/**
 * Renders a mid-run steering update into a child's next tool result.
 *
 * Unlike the shared-board notice this carries the user's own wording: it is
 * authoritative direction from the user, not peer coordination. The framing asks
 * the child to keep going silently when the update does not affect its task and
 * to report to its parent when its task is now obsolete.
 */
export namespace SteeringNotice {
  export const key = "subagent_steering_notice"

  export function text(entry: { revision: number; text: string }) {
    return [
      OPEN,
      `The user updated their direction while you were working (revision ${entry.revision}). This is a change from the user, not a peer or parent message.`,
      "If it affects your task, adjust your work and continue without asking. If it makes your task obsolete, stop taking new actions and report that to your parent. If it does not affect your task, continue as before.",
      "Completed actions are not undone by this update.",
      `User's words: ${entry.text}`,
      CLOSE,
    ].join("\n")
  }

  export function clean<T extends { metadata: Record<string, unknown> }>(value: T): T {
    if (!(key in value.metadata)) return value
    const metadata = { ...value.metadata }
    delete metadata[key]
    return { ...value, metadata }
  }

  export function output(value: string, metadata: Record<string, unknown> | undefined) {
    const marker = metadata?.[key]
    if (!marker || typeof marker !== "object" || Array.isArray(marker)) return value
    const entry = marker as { revision?: unknown; text?: unknown }
    if (typeof entry.revision !== "number" || !Number.isSafeInteger(entry.revision) || entry.revision <= 0) return value
    if (typeof entry.text !== "string" || entry.text.length === 0) return value
    return `${value}\n\n${text({ revision: entry.revision, text: entry.text })}`
  }
}
