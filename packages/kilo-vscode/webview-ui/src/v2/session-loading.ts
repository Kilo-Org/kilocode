/**
 * Whether the open session shows the session-start loader: the first transcript page of this session is in flight and
 * nothing is drawn yet. A session whose transcript is already cached, a queued prompt that waits below the transcript,
 * and a page request for another session all keep the loader off, so switching back to a loaded session stays instant.
 */
export function sessionStarting(input: {
  session: string | undefined
  /** The session whose first transcript page is in flight, from the view that starts the request. */
  loading: string | undefined
  messages: number
  queued: number
}) {
  return !!input.session && input.loading === input.session && input.messages === 0 && input.queued === 0
}

/**
 * The loader after the view starts a request for `session`: show that session until its first page lands. A transcript
 * that is already loaded keeps it off, and another session's loader stays, because that request is still open.
 */
export function startingLoader(value: string | undefined, input: { session: string; loaded: boolean }) {
  if (!input.loaded) return input.session
  return value === input.session ? undefined : value
}

/**
 * The loader after a request settles: only the newest run clears the loader it started. A superseded request, for
 * example a reconnect retry of the same session, settles after the newer run has taken over and must leave it alone.
 */
export function settledLoader(value: string | undefined, input: { session: string; run: number; attempt: number }) {
  return input.run === input.attempt && value === input.session ? undefined : value
}
