import { expect, spyOn, test } from "bun:test"
import { IndexingProfile, type IndexingProfileRecord } from "../../../src/util/profile"

test.serial("emits enabled profiles with defined fields and explicit outcomes", () => {
  const env = process.env.KILO_INDEXING_PROFILE
  const info = spyOn(console, "info").mockImplementation(() => undefined)
  try {
    process.env.KILO_INDEXING_PROFILE = "1"
    const span = IndexingProfile.start("indexing.test", { provider: "openai", omitted: undefined })
    span.add({ count: 2 })
    span.outcome("success")
    span.end()
    span.end()

    expect(info).toHaveBeenCalledTimes(1)
    const record = JSON.parse(String(info.mock.calls[0]?.[0])) as IndexingProfileRecord
    expect(record.type).toBe("kilo-indexing-profile")
    expect(record.event).toBe("indexing.test")
    expect(record.outcome).toBe("success")
    expect(record.durationMs).toBeGreaterThanOrEqual(0)
    expect(record.fields).toEqual({ provider: "openai", count: 2 })
  } finally {
    info.mockRestore()
    if (env === undefined) delete process.env.KILO_INDEXING_PROFILE
    else process.env.KILO_INDEXING_PROFILE = env
  }
})

test.serial("stays silent unless profiling is enabled with an exact one", () => {
  const env = process.env.KILO_INDEXING_PROFILE
  const info = spyOn(console, "info").mockImplementation(() => undefined)
  try {
    process.env.KILO_INDEXING_PROFILE = "true"
    IndexingProfile.start("indexing.test").end()
    delete process.env.KILO_INDEXING_PROFILE
    IndexingProfile.start("indexing.test").end()

    expect(info).not.toHaveBeenCalled()
  } finally {
    info.mockRestore()
    if (env === undefined) delete process.env.KILO_INDEXING_PROFILE
    else process.env.KILO_INDEXING_PROFILE = env
  }
})

test.serial("disposes profiles only once and defaults to an error outcome", () => {
  const env = process.env.KILO_INDEXING_PROFILE
  const info = spyOn(console, "info").mockImplementation(() => undefined)
  try {
    process.env.KILO_INDEXING_PROFILE = "1"
    const span = IndexingProfile.start("indexing.test")
    span[Symbol.dispose]()
    span[Symbol.dispose]()
    span.end()

    expect(info).toHaveBeenCalledTimes(1)
    const record = JSON.parse(String(info.mock.calls[0]?.[0])) as IndexingProfileRecord
    expect(record.outcome).toBe("error")
  } finally {
    info.mockRestore()
    if (env === undefined) delete process.env.KILO_INDEXING_PROFILE
    else process.env.KILO_INDEXING_PROFILE = env
  }
})

test.serial("does not throw when optional profile emission fails", () => {
  const env = process.env.KILO_INDEXING_PROFILE
  const failure = new Error("profile emission failed")
  const info = spyOn(console, "info").mockImplementation(() => {
    throw failure
  })
  const error = spyOn(console, "error").mockImplementation(() => undefined)
  try {
    process.env.KILO_INDEXING_PROFILE = "1"

    expect(() => IndexingProfile.start("indexing.test").end()).not.toThrow()
    expect(info).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith("failed to emit indexing profile", failure)
  } finally {
    error.mockRestore()
    info.mockRestore()
    if (env === undefined) delete process.env.KILO_INDEXING_PROFILE
    else process.env.KILO_INDEXING_PROFILE = env
  }
})
