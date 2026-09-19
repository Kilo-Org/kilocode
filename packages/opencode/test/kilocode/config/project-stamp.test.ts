import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Git } from "../../../src/git"
import { KilocodeProjectConfigStamp } from "../../../src/kilocode/config/project-stamp"
import { testEffect } from "../../lib/effect"

const failingFs = Layer.effect(
  FSUtil.Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    return FSUtil.Service.of({
      ...fs,
      up: () => Effect.fail(new FSUtil.FileSystemError({ method: "up", cause: "injected" })),
    })
  }),
).pipe(Layer.provide(FSUtil.defaultLayer))

const env = Layer.mergeAll(failingFs, Layer.mock(Git.Service)({}))
const it = testEffect(env)

describe("KilocodeProjectConfigStamp", () => {
  it.live("reports an unknown digest when source enumeration fails", () =>
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const git = yield* Git.Service
      const digest = yield* KilocodeProjectConfigStamp.digest({ fs, git, directory: "/kilocode-injected-unknown" })
      expect(digest).toBeUndefined()
    }),
  )

  it.effect("treats unknown digests as stale so the cache reloads conservatively", () =>
    Effect.sync(() => {
      // A first observation whose scan failed must still reload, otherwise the unknown value
      // keeps matching the initial state and a stale cache would never be invalidated.
      expect(KilocodeProjectConfigStamp.stale(undefined, undefined)).toBe(true)
      expect(KilocodeProjectConfigStamp.stale("a", undefined)).toBe(true)
      expect(KilocodeProjectConfigStamp.stale("a", "b")).toBe(true)
      expect(KilocodeProjectConfigStamp.stale(undefined, "b")).toBe(true)
      expect(KilocodeProjectConfigStamp.stale("a", "a")).toBe(false)
    }),
  )
})
