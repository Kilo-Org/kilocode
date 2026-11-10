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
