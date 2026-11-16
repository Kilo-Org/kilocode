// The plan follow-up creates the Code session and asks every client to show it (`tui.session.select`). The event
// names only the new session, and the sidebar and the Agent Manager both listen, so only the webview where the user
// answered a question in that directory just before takes it. The server creates the session right after the answer.
const WINDOW = 30_000

const answers = new Map<string, number>()

/** Records that the user answered a question of a session in `directory` in this webview. */
export function recordAnswer(directory: string, now = Date.now()) {
  answers.set(directory, now)
}

/** Whether this webview shows the handoff of `directory`. Consumes the answer, so one answer opens one session. */
export function takesHandoff(directory: string, now = Date.now()) {
  const time = answers.get(directory)
  answers.delete(directory)
  return time !== undefined && now - time <= WINDOW
}
