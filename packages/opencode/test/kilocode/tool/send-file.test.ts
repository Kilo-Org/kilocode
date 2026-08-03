import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "@/agent/agent"
import { KiloSessions } from "@/kilo-sessions/kilo-sessions"
import { KiloToolRegistry } from "@/kilocode/tool/registry"
import { SendFileTool } from "@/kilocode/tool/send-file"
import { MessageID, SessionID } from "@/session/schema"
import * as Truncate from "@/tool/truncate"
import type { Tool } from "@/tool/tool"
import { InstanceRef } from "@/effect/instance-ref"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { realpathSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const agentInfo = {
  name: "code",
  mode: "primary",
  options: {},
  permission: {},
} as Agent.Info

const agents = Agent.Service.of({
  get: () => Effect.succeed(agentInfo),
  list: () => Effect.succeed([agentInfo]),
  defaultInfo: () => Effect.succeed(agentInfo),
  defaultAgent: () => Effect.succeed("code"),
  requirementStatus: () =>
    Effect.succeed({
      agent: "code",
      directory: "",
      enabled: false,
      state: "ready",
      skills: [],
      mcps: [],
      vscode_extensions: [],
    }),
  guardRequirements: () => Effect.void,
  generate: () => Effect.succeed({ identifier: "code", whenToUse: "", systemPrompt: "" }),
})

const truncate = Truncate.Service.of({
  cleanup: () => Effect.void,
  write: () => Effect.succeed(""),
  output: (text) => Effect.succeed({ content: text as string, truncated: false }),
  limits: () => Effect.succeed({ maxLines: Truncate.MAX_LINES, maxBytes: Truncate.MAX_BYTES }),
})

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "call_test",
  agent: "code",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const status = spyOn(KiloSessions, "remoteStatus")

beforeEach(() => {
  status.mockReturnValue({ enabled: true, connected: true })
})

afterEach(() => {
  status.mockReset()
})

function runSendTool(params: { readonly path: string }, dir: string) {
  const layer = Layer.mergeAll(
    Layer.succeed(InstanceRef, { directory: dir, worktree: dir, project: {} as any }),
    Layer.succeed(Agent.Service, agents),
    Layer.succeed(Truncate.Service, truncate),
    Layer.succeed(FSUtil.Service, fsService),
  )
  return Effect.runPromise(
    Effect.gen(function* () {
      const result = yield* SendFileTool
      const tool = yield* result.init()
      return yield* tool.execute(params, ctx)
    }).pipe(Effect.provide(layer)),
  )
}

async function tmpdir() {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), "send-file-test-"))
  return fs.realpath(d)
}

describe("send_file tool", () => {
  test("is only available while remote is connected", () => {
    const tool = { id: "send_file" } as Tool.Def

    status.mockReturnValue({ enabled: false, connected: false })
    expect(KiloToolRegistry.available(tool, agentInfo)).toBe(false)

    status.mockReturnValue({ enabled: true, connected: false })
    expect(KiloToolRegistry.available(tool, agentInfo)).toBe(false)

    status.mockReturnValue({ enabled: true, connected: true })
    expect(KiloToolRegistry.available(tool, agentInfo)).toBe(true)
  })

  test("returns unavailable when not connected", async () => {
    status.mockReturnValue({ enabled: true, connected: false })
    const dir = await tmpdir()
    try {
      await fs.writeFile(path.join(dir, "test.txt"), "hello")
      const result = await runSendTool({ path: "test.txt" }, dir)
      expect(result.title).toBe("Send file failed")
      expect(result.output).toContain("not connected")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("sends a file with mime attachment field and base64 round-trip", async () => {
    const dir = await tmpdir()
    try {
      const content = "hello world"
      await fs.writeFile(path.join(dir, "hello.txt"), content)
      const result = await runSendTool({ path: "hello.txt" }, dir)

      expect(result.title).toBe("Sent file: hello.txt")
      expect(result.output).toContain("hello.txt")
      expect(result.output).toContain("delivered to the user")
      expect(result.attachments).toHaveLength(1)
      const att = result.attachments![0]
      expect(att.type).toBe("file")
      expect(att.mime).toBe("text/plain")
      expect(att.filename).toBe("hello.txt")
      expect(att.url).toStartWith("data:text/plain;base64,")

      // Verify base64 round-trip
      const prefix = "data:text/plain;base64,"
      const b64 = att.url!.slice(prefix.length)
      const decoded = Buffer.from(b64, "base64").toString("utf-8")
      expect(decoded).toBe(content)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("filename is always basename, never a full path", async () => {
    const dir = await tmpdir()
    try {
      await fs.mkdir(path.join(dir, "sub"), { recursive: true })
      const content = Buffer.from([0x89, 0x50, 0x4e, 0x47])
      await fs.writeFile(path.join(dir, "sub", "deep.png"), content)

      const result = await runSendTool({ path: "sub/deep.png" }, dir)

      expect(result.title).toBe("Sent file: deep.png")
      expect(result.attachments).toHaveLength(1)
      expect(result.attachments![0].filename).toBe("deep.png")
      // The sniff should detect PNG from magic bytes
      expect(result.attachments![0].mime).toBe("image/png")
      expect(result.attachments![0].url).toStartWith("data:image/png;base64,")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("sniffs correct MIME for a file with wrong extension", async () => {
    const dir = await tmpdir()
    try {
      // Actually just test a real PNG — KiloReadObject opens by path,
      // the sniffAttachmentMime looks at magic bytes
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
      await fs.writeFile(path.join(dir, "secret.dat"), png)
      const result = await runSendTool({ path: "secret.dat" }, dir)
      expect(result.attachments![0].mime).toBe("image/png")
      expect(result.attachments![0].filename).toBe("secret.dat")
      expect(result.attachments![0].url).toStartWith("data:image/png;base64,")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  // kilocode_change start — send_file now authorizes missing files with external_directory + read
  // before returning a structured fail() result, matching the read.ts security sequence.
  test("authorizes missing file before returning fail result", async () => {
    const dir = await tmpdir()
    try {
      const asks: any[] = []
      const askCtx: Tool.Context = {
        ...ctx,
        ask: (req) =>
          Effect.sync(() => {
            asks.push(req)
          }),
      }
      const layer = Layer.mergeAll(
        Layer.succeed(InstanceRef, { directory: dir, worktree: dir, project: {} as any }),
        Layer.succeed(Agent.Service, agents),
        Layer.succeed(Truncate.Service, truncate),
        Layer.succeed(FSUtil.Service, fsService),
      )
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const info = yield* SendFileTool
          const tool = yield* info.init()
          return yield* tool.execute({ path: "nope.txt" }, askCtx)
        }).pipe(Effect.provide(layer)),
      )
      expect(result.title).toBe("Send file failed")
      expect(result.output).toContain("File not found")
      expect(result.output).toContain("nope.txt")
      // Authorization must run before the failure: expect read permission.
      // external_directory is only required for paths outside worktree —
      // a missing file inside worktree only triggers read permission.
      const read = asks.find((a: any) => a.permission === "read")
      expect(read).toBeDefined()
      expect(read?.always).toEqual(["*"])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
  // kilocode_change end

  // kilocode_change start — send_file now authorizes directories before returning a
  // structured fail() result.
  test("authorizes directory before returning fail result", async () => {
    const dir = await tmpdir()
    try {
      await fs.mkdir(path.join(dir, "mydir"))
      const asks: any[] = []
      const askCtx: Tool.Context = {
        ...ctx,
        ask: (req) =>
          Effect.sync(() => {
            asks.push(req)
          }),
      }
      const layer = Layer.mergeAll(
        Layer.succeed(InstanceRef, { directory: dir, worktree: dir, project: {} as any }),
        Layer.succeed(Agent.Service, agents),
        Layer.succeed(Truncate.Service, truncate),
        Layer.succeed(FSUtil.Service, fsService),
      )
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const info = yield* SendFileTool
          const tool = yield* info.init()
          return yield* tool.execute({ path: "mydir" }, askCtx)
        }).pipe(Effect.provide(layer)),
      )
      expect(result.title).toBe("Send file failed")
      expect(result.output).toContain("is a directory")
      // Authorization must run before the failure.
      const ext = asks.find((a: any) => a.permission === "external_directory")
      expect(ext).toBeUndefined() // inside worktree
      const read = asks.find((a: any) => a.permission === "read")
      expect(read).toBeDefined()
      expect(read?.always).toEqual(["*"])
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
  // kilocode_change end

  test("rejects file larger than 4 MiB before reading", async () => {
    const dir = await tmpdir()
    try {
      const big = path.join(dir, "big.bin")
      // Create a sparse file > 4 MiB without writing all bytes
      const handle = await fs.open(big, "w")
      await handle.truncate(5 * 1024 * 1024)
      await handle.close()

      const result = await runSendTool({ path: "big.bin" }, dir)
      expect(result.title).toBe("Send file too large")
      expect(result.output).toContain("exceeds the 4 MiB limit")
      expect(result.output).toContain("workspace path")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("asks for external_directory and read permissions when file is outside workspace", async () => {
    const dir = await tmpdir()
    const outside = await tmpdir()
    try {
      const outsideFile = path.join(outside, "outside.txt")
      await fs.writeFile(outsideFile, "secret")

      const asks: any[] = []
      const askCtx: Tool.Context = {
        ...ctx,
        ask: (req) =>
          Effect.sync(() => {
            asks.push(req)
          }),
      }

      const layer = Layer.mergeAll(
        Layer.succeed(InstanceRef, { directory: dir, worktree: dir, project: {} as any }),
        Layer.succeed(Agent.Service, agents),
        Layer.succeed(Truncate.Service, truncate),
        Layer.succeed(FSUtil.Service, fsService),
      )

      await Effect.runPromise(
        Effect.gen(function* () {
          const info = yield* SendFileTool
          const tool = yield* info.init()
          return yield* tool.execute({ path: outsideFile }, askCtx)
        }).pipe(Effect.provide(layer)),
      )

      const ext = asks.find((a: any) => a.permission === "external_directory")
      expect(ext).toBeDefined()
      expect(ext?.patterns).toBeDefined()

      const read = asks.find((a: any) => a.permission === "read")
      expect(read).toBeDefined()
      expect(read?.patterns).toBeDefined()
      expect(read?.always).toEqual(["*"])
      // Patterns must be non-empty and relative to worktree. The exact content
      // depends on filesystem layout (symlinks may produce ../ segments), but
      // every pattern must be a valid relative path — never empty or ".".
      for (const p of read.patterns) {
        expect(p.length).toBeGreaterThan(0)
        expect(p).not.toBe(".")
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  test("read permission patterns work with relative-path params inside worktree", async () => {
    const dir = await tmpdir()
    try {
      await fs.mkdir(path.join(dir, "sub"), { recursive: true })
      await fs.writeFile(path.join(dir, "sub", "hello.txt"), "hello")

      const asks: any[] = []
      const askCtx: Tool.Context = {
        ...ctx,
        ask: (req) =>
          Effect.sync(() => {
            asks.push(req)
          }),
      }

      const layer = Layer.mergeAll(
        Layer.succeed(InstanceRef, { directory: dir, worktree: dir, project: {} as any }),
        Layer.succeed(Agent.Service, agents),
        Layer.succeed(Truncate.Service, truncate),
        Layer.succeed(FSUtil.Service, fsService),
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const info = yield* SendFileTool
          const tool = yield* info.init()
          return yield* tool.execute({ path: "sub/hello.txt" }, askCtx)
        }).pipe(Effect.provide(layer)),
      )

      // File inside worktree: no external_directory needed
      const ext = asks.find((a: any) => a.permission === "external_directory")
      expect(ext).toBeUndefined()

      // Read permission is still required
      const read = asks.find((a: any) => a.permission === "read")
      expect(read).toBeDefined()
      expect(read.patterns.length).toBeGreaterThan(0)
      expect(read.always).toEqual(["*"])

      // Verify the tool actually sent the file
      expect(result.title).toBe("Sent file: hello.txt")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("reference-root bypass skips external_directory ask", async () => {
    const dir = await tmpdir()
    const refDir = await tmpdir()
    try {
      const refFile = path.join(refDir, "inner.txt")
      await fs.writeFile(refFile, "ref-content")

      const asks: any[] = []
      const askCtx: Tool.Context = {
        ...ctx,
        extra: { referenceRoot: refDir },
        ask: (req) =>
          Effect.sync(() => {
            asks.push(req)
          }),
      }

      const layer = Layer.mergeAll(
        Layer.succeed(InstanceRef, { directory: dir, worktree: dir, project: {} as any }),
        Layer.succeed(Agent.Service, agents),
        Layer.succeed(Truncate.Service, truncate),
        Layer.succeed(FSUtil.Service, fsService),
      )

      await Effect.runPromise(
        Effect.gen(function* () {
          const info = yield* SendFileTool
          const tool = yield* info.init()
          return yield* tool.execute({ path: refFile }, askCtx)
        }).pipe(Effect.provide(layer)),
      )

      // A reference-root file outside the worktree bypasses external_directory.
      const ext = asks.find((a: any) => a.permission === "external_directory")
      expect(ext).toBeUndefined()

      // But read permission is still required
      const read = asks.find((a: any) => a.permission === "read")
      expect(read).toBeDefined()
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
      await fs.rm(refDir, { recursive: true, force: true })
    }
  })

  test("registers with id and has description in registry", async () => {
    const dir = await tmpdir()
    try {
      const layer = Layer.mergeAll(
        Layer.succeed(InstanceRef, { directory: dir, worktree: dir, project: {} as any }),
        Layer.succeed(Agent.Service, agents),
        Layer.succeed(Truncate.Service, truncate),
        Layer.succeed(FSUtil.Service, fsService),
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const info = yield* SendFileTool
          const tool = yield* info.init()
          return { id: info.id, description: tool.description }
        }).pipe(Effect.provide(layer)),
      )

      expect(result.id).toBe("send_file")
      expect(result.description).toContain("Send a file from the local machine")
      expect(result.description).toContain("Do NOT use this tool")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("included in extra() list", () => {
    const tool = { id: "send_file" } as Tool.Def
    const extra = KiloToolRegistry.extra(
      {
        codebase: tool,
        recall: tool,
        managerModels: tool,
        memory: tool,
        save: tool,
        manager: tool,
        process: tool,
        chart: tool,
        image: tool,
        notify: { id: "notify_user" } as Tool.Def,
        send: tool,
      },
      {},
    )

    const ids = extra.map((t) => t.id)
    expect(ids).toContain("send_file")
  })

  test("non-NotFound stat failure propagates as an error", async () => {
    const dir = await tmpdir()
    try {
      const permError: any = new Error("Permission denied")
      permError.code = "EPERM"
      permError.reason = { _tag: "PermissionDenied" }

      const failingFs = FSUtil.Service.of({
        stat: () => Effect.fail(permError) as any,
        realPath: (candidate: string) =>
          Effect.try({
            try: () => realpathSync(candidate),
            catch: (cause) => cause,
          }),
      } as unknown as FSUtil.Interface)

      const layer = Layer.mergeAll(
        Layer.succeed(InstanceRef, { directory: dir, worktree: dir, project: {} as any }),
        Layer.succeed(Agent.Service, agents),
        Layer.succeed(Truncate.Service, truncate),
        Layer.succeed(FSUtil.Service, failingFs),
      )

      const promise = Effect.runPromise(
        Effect.gen(function* () {
          const info = yield* SendFileTool
          const tool = yield* info.init()
          return yield* tool.execute({ path: "anything.txt" }, ctx)
        }).pipe(Effect.provide(layer)),
      )

      await expect(promise).rejects.toMatchObject({ code: "EPERM" })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
// kilocode_change start — fsService mock now includes stat + realPath for the
// missing/directory authorization sequence that runs before KiloReadObject.file().
// stat only fabricates NotFound for ENOENT; other errors propagate.
const fsService = FSUtil.Service.of({
  stat: (candidate: string) =>
    Effect.tryPromise({
      try: async () => {
        const info = await fs.stat(candidate)
        return { type: info.isFile() ? "File" : info.isDirectory() ? "Directory" : "Other" }
      },
      catch: (cause) => {
        if (
          cause != null &&
          typeof cause === "object" &&
          "code" in cause &&
          (cause as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          const err = new Error() as any
          err.reason = { _tag: "NotFound" }
          return err
        }
        return cause
      },
    }) as any,
  realPath: (candidate: string) =>
    Effect.try({
      try: () => realpathSync(candidate),
      catch: (cause) => cause,
    }),
} as FSUtil.Interface)
// kilocode_change end
