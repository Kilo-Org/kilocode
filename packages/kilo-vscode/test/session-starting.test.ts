// The session-start loader replaces the welcome screen while the first transcript page of an uncached session is in
// flight, as the v1 chat showed. A cached transcript, a queued prompt and another session's request keep it off.
import { describe, expect, it } from "bun:test"
import { sessionStarting } from "../webview-ui/src/v2/session-loading"

const idle = { session: "ses_a", loading: undefined, messages: 0, queued: 0 }

describe("sessionStarting", () => {
  it("shows while the first page of this session is in flight and nothing is drawn", () => {
    expect(sessionStarting({ ...idle, loading: "ses_a" })).toBe(true)
  })

  it("stays off without a session, as for a new draft composer", () => {
    expect(sessionStarting({ ...idle, session: undefined, loading: "ses_a" })).toBe(false)
  })

  it("stays off for another session's request", () => {
    expect(sessionStarting({ ...idle, loading: "ses_b" })).toBe(false)
  })

  it("stays off when the cached transcript is already drawn", () => {
    expect(sessionStarting({ ...idle, loading: "ses_a", messages: 4 })).toBe(false)
  })

  it("stays off while a queued prompt waits below the transcript", () => {
    expect(sessionStarting({ ...idle, loading: "ses_a", queued: 1 })).toBe(false)
  })

  it("stays off after the page settles", () => {
    expect(sessionStarting({ ...idle, loading: undefined })).toBe(false)
  })
})
