// The session-start loader replaces the welcome screen while the first transcript page of an uncached session is in
// flight, as the v1 chat showed. A cached transcript, a queued prompt and another session's request keep it off.
import { describe, expect, it } from "bun:test"
import { sessionStarting, settledLoader, startingLoader } from "../webview-ui/src/v2/session-loading"

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

describe("startingLoader", () => {
  it("takes the session whose first page starts", () => {
    expect(startingLoader(undefined, { session: "ses_a", loaded: false })).toBe("ses_a")
  })

  it("takes a newer session over the loader of another one", () => {
    expect(startingLoader("ses_a", { session: "ses_b", loaded: false })).toBe("ses_b")
  })

  it("leaves a loaded transcript without a loader", () => {
    expect(startingLoader(undefined, { session: "ses_a", loaded: true })).toBeUndefined()
  })

  it("clears its own loader once the transcript is loaded", () => {
    expect(startingLoader("ses_a", { session: "ses_a", loaded: true })).toBeUndefined()
  })

  it("keeps another session's open loader when a loaded transcript refreshes", () => {
    expect(startingLoader("ses_a", { session: "ses_b", loaded: true })).toBe("ses_a")
  })
})

describe("settledLoader", () => {
  it("clears the loader of the run that started it", () => {
    expect(settledLoader("ses_a", { session: "ses_a", run: 1, attempt: 1 })).toBeUndefined()
  })

  it("keeps a newer run's loader when a superseded request settles, as on a reconnect retry", () => {
    expect(settledLoader("ses_a", { session: "ses_a", run: 1, attempt: 2 })).toBe("ses_a")
  })

  it("keeps the loader of a settled session when another session owns it", () => {
    expect(settledLoader("ses_b", { session: "ses_a", run: 2, attempt: 2 })).toBe("ses_b")
  })

  it("stays off without a loader", () => {
    expect(settledLoader(undefined, { session: "ses_a", run: 1, attempt: 1 })).toBeUndefined()
  })
})
