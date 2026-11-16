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

/** Server placeholder assigned at creation: "New session - <ISO>" or "Child session - <ISO>". */
export const DEFAULT_SESSION_TITLE = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export function isPlaceholderTitle(title: string | null | undefined): boolean {
  const value = title?.trim()
  return !value || DEFAULT_SESSION_TITLE.test(value)
}

/** Title for a card or tab: real title, else the session slug, else the untitled label. */
export function displayTitle(session: { title?: string | null; slug?: string | null }, untitled: string): string {
  if (!isPlaceholderTitle(session.title)) return session.title!.trim()
  return session.slug?.trim() || untitled
}

/** Creation-time title from a tool task name; undefined keeps the server placeholder. */
export function creationTitle(name: string | undefined): string | undefined {
  const parsed = parseSessionTitle(name)
  return "value" in parsed ? parsed.value : undefined
}
