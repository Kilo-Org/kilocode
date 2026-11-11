const markers = [
  "unauthorized",
  "authentication required",
  "needs authentication",
  "not authenticated",
  "browser authorization",
  "token exchange failed",
  "invalid_token",
  "invalid_grant",
]

const oauth = /\boauth\b/
const status = /\b(?:http|status)\D{0,10}40[13]\b/

/**
 * Whether a remote connection failure message describes an authentication problem, so the server
 * should ask the user to sign in rather than report a plain failure. Matches an authentication
 * phrase, an OAuth reference, or a 401/403 status name.
 */
export function authFailure(error: string | undefined): boolean {
  if (!error) return false
  const value = error.toLowerCase()
  if (markers.some((marker) => value.includes(marker))) return true
  if (oauth.test(value)) return true
  return status.test(value)
}
