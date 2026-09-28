/** Keep request URLs, headers, response bodies, and arbitrary error messages out of logs. */
export function failure(error: unknown) {
  const name = error instanceof Error && /^[A-Za-z]{0,64}Error$/.test(error.name) ? error.name : "UnknownError"
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined
  return {
    reason: name === "TimeoutError" ? ("timeout" as const) : ("status" as const),
    name,
    ...(typeof code === "string" && /^E[A-Z_]{1,40}$/.test(code) ? { code } : {}),
  }
}
