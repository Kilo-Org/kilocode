import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { assertWrite, current, enabled, run } from "../src/context"
import type { Profile } from "../src/profile"

function makeProfile(
  allowWrite: Profile["filesystem"]["allowWrite"],
  denyWrite: Profile["filesystem"]["denyWrite"] = [],
  denyNames: Profile["filesystem"]["denyNames"] = [],
): Profile {
  return {
    filesystem: { allowWrite, denyWrite, denyNames },
    network: { mode: "allow", allowedHosts: [] },
    environment: { deny: [], set: {} },
  }
}

describe("sandbox profile context", () => {
  let root = ""

  beforeAll(async () => {
    root = await realpath(await mkdtemp(path.join(tmpdir(), "kilo-sandbox-context-")))
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test("is disabled outside run and exposes the normalized current profile inside run", async () => {
    expect(await Effect.runPromise(enabled)).toBe(false)
    const value = await Effect.runPromise(
      run(makeProfile([{ path: root, kind: "subtree" }]), Effect.all([enabled, current])),
    )
    expect(value[0]).toBe(true)
    expect(value[1]?.filesystem.allowWrite[0]?.path).toBe(root)
    expect(await Effect.runPromise(current)).toBeUndefined()
  })

  test("rejects writes outside the allowed roots", async () => {
    const error = await Effect.runPromise(
      run(makeProfile([]), assertWrite(path.join(root, "outside.txt")).pipe(Effect.flip)),
    )
    expect(error.reason._tag).toBe("PermissionDenied")
  })

  test("applies deny rules before overlapping allows", async () => {
    const denied = path.join(root, ".git")
    const target = path.join(denied, "config")
    const profile = makeProfile([{ path: root, kind: "subtree" }], [{ path: denied, kind: "subtree" }])
    const error = await Effect.runPromise(run(profile, assertWrite(target).pipe(Effect.flip)))
    expect(error.reason._tag).toBe("PermissionDenied")
  })

  test("applies denied path names under allowed roots", async () => {
    const target = path.join(root, "external", ".git", "config")
    const error = await Effect.runPromise(
      run(makeProfile([{ path: root, kind: "subtree" }], [], [".git"]), assertWrite(target).pipe(Effect.flip)),
    )
    expect(error.reason._tag).toBe("PermissionDenied")
  })

  test("canonicalizes the longest existing ancestor across symlinks", async () => {
    const allowed = path.join(root, "allowed")
    const outside = path.join(root, "outside")
    await mkdir(allowed)
    await mkdir(outside)
    await symlink(outside, path.join(allowed, "link"), "junction")

    const error = await Effect.runPromise(
      run(
        makeProfile([{ path: allowed, kind: "subtree" }]),
        assertWrite(path.join(allowed, "link", "new.txt")).pipe(Effect.flip),
      ),
    )
    expect(error.reason._tag).toBe("PermissionDenied")
  })

  test("resolves dangling symlinks before authorizing a write", async () => {
    const allowed = path.join(root, "dangling-allowed")
    const outside = path.join(root, "dangling-outside.txt")
    await mkdir(allowed)
    await symlink(outside, path.join(allowed, "link"))

    const error = await Effect.runPromise(
      run(makeProfile([{ path: allowed, kind: "subtree" }]), assertWrite(path.join(allowed, "link")).pipe(Effect.flip)),
    )
    expect(error.reason._tag).toBe("PermissionDenied")
  })
})
