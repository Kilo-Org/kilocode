export const SESSION_TITLE_LIMIT = 200

// Block terminal/display controls and bidi marks that can visually spoof a title.
const unsafe = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u

type SessionTitleIssue = "invalid" | "required" | "too_long" | "control"
type SessionTitleResult = { value: string } | { error: SessionTitleIssue }

export function parseSessionTitle(raw: unknown): SessionTitleResult {
  if (typeof raw !== "string") return { error: "invalid" }
  const value = raw.trim()
  if (!value) return { error: "required" }
  if (value.length > SESSION_TITLE_LIMIT) return { error: "too_long" }
  if (unsafe.test(value)) return { error: "control" }
  return { value }
}
