import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import path from "path"
import type { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { SessionID, MessageID } from "../../src/session/schema"
import { assertExternalDirectory } from "../../src/tool/external-directory"
import type { Tool } from "../../src/tool"
import { Filesystem } from "../../src/util"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"
import { tmpdir } from "../fixture/fixture"

const base: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_test-boundary-session"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "code",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
}

const glob = (p: string) =>
  process.platform === "win32" ? AppFileSystem.normalizePathPattern(p) : p.replaceAll("\\", "/")

const asks = () => {
  const items: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
  const ctx: Tool.Context = {
    ...base,
    ask: (req) =>
      Effect.sync(() => {
        items.push(req)
      }),
  }
  return { items, ctx }
}

describe("kilocode external directory boundaries", () => {
  test("asks before accessing outside a repo-root session", async () => {
    await using repo = await tmpdir({ git: true })
    await using outer = await tmpdir()
    const file = path.join(outer.path, "outside.txt")
    const { items, ctx } = asks()

    await Instance.provide({
      directory: repo.path,
      fn: async () => {
        try {
          await assertExternalDirectory(ctx, file)
        } finally {
          await Instance.dispose()
        }
      },
    })

    const ext = items.find((item) => item.permission === "external_directory")
    expect(ext).toBeDefined()
    expect(ext!.patterns).toEqual([glob(path.join(outer.path, "*"))])
    expect(ext!.always).toEqual([glob(path.join(outer.path, "*"))])
    expect(ext!.metadata).toMatchObject({ filepath: file, parentDir: outer.path })
  })

  test("asks when the instance directory is a filesystem root", async () => {
    await using outer = await tmpdir()
    const root = path.parse(outer.path).root
    const file = path.join(outer.path, "outside-root.txt")
    const { items, ctx } = asks()

    await Instance.provide({
      directory: root,
      fn: async () => {
        try {
          await assertExternalDirectory(ctx, file)
        } finally {
          await Instance.dispose()
        }
      },
    })

    const ext = items.find((item) => item.permission === "external_directory")
    expect(ext).toBeDefined()
    expect(ext!.patterns).toEqual([glob(path.join(outer.path, "*"))])
    expect(ext!.metadata).toMatchObject({ filepath: file, parentDir: outer.path })
  })

  test("contains helpers keep dot-prefixed child names internal", () => {
    expect(Filesystem.contains("/project", "/project/..cache/file")).toBe(true)
    expect(AppFileSystem.contains("/a/b", "/a/b/..cache/file")).toBe(true)
  })

  test("AppFileSystem.contains rejects cross-drive paths on Windows", () => {
    if (process.platform !== "win32") return
    expect(AppFileSystem.contains("C:\\repo", "D:\\outside\\file.txt")).toBe(false)
  })
})
