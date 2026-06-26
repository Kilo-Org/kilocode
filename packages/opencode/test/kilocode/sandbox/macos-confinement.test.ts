import { afterEach, describe, expect } from "bun:test"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import * as AppProcess from "@opencode-ai/core/process"
import {
  mutate,
  run as sandbox,
  withRunner,
  type MutationRequest,
  type MutationRunner,
  type Profile,
} from "@kilocode/sandbox"
import { Effect, Exit, Layer } from "effect"
import { ChildProcess } from "effect/unstable/process"
import fs from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import iconv from "iconv-lite"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Format } from "@/format"
import { BackgroundProcess } from "@/kilocode/background-process"
import { BackgroundProcessTool } from "@/kilocode/tool/background-process"
import * as EncodedIO from "@/kilocode/tool/encoded-io"
import { Instruction } from "@/session/instruction"
import { LSP } from "@/lsp/lsp"
import { Permission } from "@/permission"
import { MessageID, SessionID } from "@/session/schema"
import { ApplyPatchTool } from "@/tool/apply_patch"
import { EditTool } from "@/tool/edit"
import type * as Tool from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { WriteTool } from "@/tool/write"
import { disposeAllInstances, provideTmpdirInstance } from "../../fixture/fixture"
import { testEffect } from "../../lib/effect"

const gate: { run?: (() => Promise<void>) | undefined; requests?: MutationRequest[] | undefined } = {}
const runner: MutationRunner = (profile, request) =>
  Effect.gen(function* () {
    gate.requests?.push(request)
    if (gate.run) yield* Effect.promise(gate.run)
    return yield* mutate(profile, request)
  })
const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    AppFileSystem.defaultLayer,
    AppProcess.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Instruction.defaultLayer,
    LSP.defaultLayer,
    Bus.layer,
    Format.defaultLayer,
    Truncate.defaultLayer,
  ),
)

const context = (ask: Tool.Context["ask"] = () => Effect.void): Tool.Context => ({
  sessionID: SessionID.make("ses_macos_sandbox"),
  messageID: MessageID.make("msg_macos_sandbox"),
  callID: "sandbox-call",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask,
})

function profile(root: string): Profile {
  return {
    filesystem: {
      allowWrite: [{ path: root, kind: "subtree" }],
      denyWrite: [],
      denyNames: [".git"],
      temporaryDirectory: path.join(root, ".tmp"),
    },
    network: { mode: "deny", allowedHosts: [] },
    environment: { deny: [], set: {} },
  }
}

const runWrite = (args: { filePath: string; content: string }, ctx = context()) =>
  Effect.gen(function* () {
    const info = yield* WriteTool
    return yield* (yield* info.init()).execute(args, ctx)
  })

const runEdit = (args: { filePath: string; oldString: string; newString: string }, ctx = context()) =>
  Effect.gen(function* () {
    const info = yield* EditTool
    return yield* (yield* info.init()).execute(args, ctx)
  })

const runPatch = (patchText: string, ctx = context()) =>
  Effect.gen(function* () {
    const info = yield* ApplyPatchTool
    return yield* (yield* info.init()).execute({ patchText }, ctx)
  })

const runBackground = (args: { action: "start"; command: string } | { action: "restart"; id: BackgroundProcess.ID }) =>
  Effect.gen(function* () {
    const info = yield* BackgroundProcessTool
    return yield* (yield* info.init()).execute(args, context())
  })

const attackSource = String.raw`
import fs from "node:fs/promises"
const input = JSON.parse(await new Response(Bun.stdin.stream()).text())
const exists = (file) => fs.access(file).then(() => true, () => false)
while (!(await exists(input.start)) && !(await exists(input.stop))) await Bun.sleep(1)
const state = { index: 0, ready: false }
while (!(await exists(input.stop))) {
  const temp = input.live + ".swap-" + process.pid
  await fs.rm(temp, { force: true })
  await fs.symlink(input.targets[state.index % input.targets.length], temp)
  await fs.rename(temp, input.live)
  state.index++
  if (!state.ready) {
    await fs.writeFile(input.ready, "ready")
    state.ready = true
  }
  await Bun.sleep(0)
}
`

async function wait(file: string) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (
      await fs.access(file).then(
        () => true,
        () => false,
      )
    )
      return
    await Bun.sleep(1)
  }
  throw new Error(`Timed out waiting for ${file}`)
}

async function attacker(root: string, live: string, targets: ReadonlyArray<string>) {
  const start = path.join(root, "race-start")
  const ready = path.join(root, "race-ready")
  const stop = path.join(root, "race-stop")
  const proc = Bun.spawn([process.execPath, "-e", attackSource], {
    env: { ...process.env, BUN_BE_BUN: "1" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })
  await proc.stdin.write(JSON.stringify({ start, ready, stop, live, targets }))
  await proc.stdin.end()
  const state = { open: false }
  return {
    open: async () => {
      if (state.open) return
      state.open = true
      await fs.writeFile(start, "start")
      await wait(ready)
    },
    close: async () => {
      await fs.writeFile(stop, "stop")
      await fs.writeFile(start, "start")
      const code = await proc.exited
      if (code !== 0) throw new Error((await new Response(proc.stderr).text()) || `Attacker exited with ${code}`)
    },
  }
}

async function outside(dir: string) {
  return fs.mkdtemp(path.join(tmpdir(), `${path.basename(dir)}-outside-`))
}

const encoding = {
  utf16: (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode(text, "utf-16le")]),
  windows1251: (text: string) => iconv.encode(text, "windows-1251"),
  bom: (text: string) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]),
}

afterEach(async () => {
  gate.run = undefined
  gate.requests = undefined
  await disposeAllInstances()
})

describe.skipIf(process.platform !== "darwin").serial("real macOS sandbox confinement", () => {
  it.live("confines shell writes inside the workspace and denies outside and .git", () =>
    provideTmpdirInstance((dir) =>
      Effect.acquireUseRelease(
        Effect.promise(async () => {
          const ext = await outside(dir)
          await fs.mkdir(path.join(dir, ".git"), { recursive: true })
          return ext
        }),
        (ext) =>
          Effect.gen(function* () {
            const proc = yield* AppProcess.Service
            const inside = path.join(dir, "inside.txt")
            const escaped = path.join(ext, "outside.txt")
            const git = path.join(dir, ".git", "blocked.txt")
            const write = (file: string) =>
              sandbox(
                profile(dir),
                proc.run(ChildProcess.make("/bin/sh", ["-c", `printf confined > ${JSON.stringify(file)}`])),
              )
            expect((yield* write(inside)).exitCode).toBe(0)
            expect((yield* write(escaped)).exitCode).not.toBe(0)
            expect((yield* write(git)).exitCode).not.toBe(0)
            const results = yield* Effect.promise(() =>
              Promise.all([
                fs.readFile(inside, "utf8"),
                fs.access(escaped).then(
                  () => true,
                  () => false,
                ),
                fs.access(git).then(
                  () => true,
                  () => false,
                ),
              ]),
            )
            expect(results).toEqual(["confined", false, false])
          }),
        (ext) => Effect.promise(() => fs.rm(ext, { recursive: true, force: true })),
      ),
    ),
  )

  it.live("protects denied policy state while sibling state remains writable", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const proc = yield* AppProcess.Service
        const state = path.join(dir, "state")
        const store = path.join(dir, "policy")
        const moved = path.join(state, "moved")
        const sibling = path.join(state, "sibling.txt")
        yield* Effect.promise(() => Promise.all([fs.mkdir(state), fs.mkdir(store)]))
        const base = profile(dir)
        const policy: Profile = {
          ...base,
          filesystem: {
            ...base.filesystem,
            allowWrite: [{ path: state, kind: "subtree" }],
            denyWrite: [{ path: store, kind: "subtree" }],
          },
        }
        const write = yield* sandbox(
          policy,
          proc.run(ChildProcess.make("/bin/sh", ["-c", `printf allowed > ${JSON.stringify(sibling)}`])),
        )
        const rename = yield* sandbox(policy, proc.run(ChildProcess.make("/bin/mv", [store, moved])))

        expect(write.exitCode).toBe(0)
        expect(rename.exitCode).not.toBe(0)
        expect(yield* Effect.promise(() => fs.readFile(sibling, "utf8"))).toBe("allowed")
        expect(yield* Effect.promise(() => fs.stat(store).then((entry) => entry.isDirectory()))).toBe(true)
      }),
    ),
  )

  it.live("keeps permission approval and denial independent from confinement", () =>
    provideTmpdirInstance((dir) =>
      Effect.acquireUseRelease(
        Effect.promise(() => outside(dir)),
        (ext) =>
          Effect.gen(function* () {
            const target = path.join(ext, "approved.txt")
            const requests: string[] = []
            const approved = context((input) => Effect.sync(() => requests.push(input.permission)))
            const escaped = yield* sandbox(
              profile(dir),
              runWrite({ filePath: target, content: "blocked" }, approved),
            ).pipe(Effect.exit)
            expect(Exit.isFailure(escaped)).toBe(true)
            expect(requests).toContain("external_directory")
            expect(requests).toContain("edit")
            expect(
              yield* Effect.promise(() =>
                fs.access(target).then(
                  () => true,
                  () => false,
                ),
              ),
            ).toBe(false)

            const denied = path.join(dir, "permission-denied.txt")
            const rejected = context(() => Effect.die(new Permission.RejectedError()))
            const result = yield* sandbox(
              profile(dir),
              runWrite({ filePath: denied, content: "blocked" }, rejected),
            ).pipe(Effect.exit)
            expect(Exit.isFailure(result)).toBe(true)
            expect(
              yield* Effect.promise(() =>
                fs.access(denied).then(
                  () => true,
                  () => false,
                ),
              ),
            ).toBe(false)
          }),
        (ext) => Effect.promise(() => fs.rm(ext, { recursive: true, force: true })),
      ),
    ),
  )

  it.live("allows Write, Edit, and ApplyPatch within the workspace", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const write = path.join(dir, "nested", "write.txt")
        const edit = path.join(dir, "edit.txt")
        const patch = path.join(dir, "patch.txt")
        const second = path.join(dir, "second.txt")
        yield* Effect.promise(async () => {
          await fs.mkdir(path.join(dir, ".tmp"), { recursive: true })
          await fs.writeFile(edit, "before\n")
          await fs.writeFile(patch, "before\n")
          await fs.writeFile(second, "before\n")
        })
        gate.requests = []
        yield* withRunner(runner, sandbox(profile(dir), runWrite({ filePath: write, content: "written" })))
        expect(gate.requests).toHaveLength(1)
        expect(gate.requests[0]).toMatchObject({
          op: "batch",
          operations: [{ op: "makeDirectory" }, { op: "writeFile" }],
        })
        gate.requests = []
        yield* withRunner(
          runner,
          sandbox(profile(dir), runEdit({ filePath: edit, oldString: "before", newString: "edited" })),
        )
        expect(gate.requests).toHaveLength(1)
        expect(gate.requests[0]).toMatchObject({
          op: "batch",
          operations: [{ op: "makeDirectory" }, { op: "writeFile" }],
        })
        gate.requests = []
        yield* withRunner(
          runner,
          sandbox(
            profile(dir),
            runPatch(
              "*** Begin Patch\n*** Update File: patch.txt\n@@\n-before\n+patched\n*** Update File: second.txt\n@@\n-before\n+second\n*** End Patch",
            ),
          ),
        )
        const content = yield* Effect.promise(() =>
          Promise.all([
            fs.readFile(write, "utf8"),
            fs.readFile(edit, "utf8"),
            fs.readFile(patch, "utf8"),
            fs.readFile(second, "utf8"),
          ]),
        )
        expect(content).toEqual(["written", "edited\n", "patched\n", "second\n"])
        expect(gate.requests).toHaveLength(2)
        for (const request of gate.requests) {
          expect(request).toMatchObject({
            op: "batch",
            operations: [{ op: "makeDirectory" }, { op: "writeFile" }],
          })
        }
      }),
    ),
  )

  it.live("preserves UTF-16 LE, Windows-1251, and UTF-8 BOM mutations", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const write = path.join(dir, "utf16.txt")
        const edit = path.join(dir, "windows1251.txt")
        const patch = path.join(dir, "bom.txt")
        yield* Effect.promise(async () => {
          await fs.mkdir(path.join(dir, ".tmp"), { recursive: true })
          await fs.writeFile(write, encoding.utf16("before"))
          await fs.writeFile(edit, encoding.windows1251("Привет мир"))
          await fs.writeFile(patch, encoding.bom("before\n"))
        })
        yield* sandbox(profile(dir), runWrite({ filePath: write, content: "after" }))
        yield* sandbox(profile(dir), runEdit({ filePath: edit, oldString: "мир", newString: "тест" }))
        yield* sandbox(
          profile(dir),
          runPatch("*** Begin Patch\n*** Update File: bom.txt\n@@\n-before\n+after\n*** End Patch"),
        )
        const afs = yield* AppFileSystem.Service
        const synced = [
          { path: path.join(dir, "formatted-utf16.txt"), encoding: "utf-16le", bom: false },
          { path: path.join(dir, "formatted-windows1251.txt"), encoding: "windows-1251", bom: false },
          { path: path.join(dir, "formatted-bom.txt"), encoding: "utf-8-bom", bom: true },
        ]
        for (const item of synced) {
          yield* sandbox(
            profile(dir),
            afs
              .writeFileString(item.path, "formatted")
              .pipe(Effect.andThen(EncodedIO.sync(afs, item.path, item.bom, item.encoding))),
          )
        }
        const bytes = yield* Effect.promise(() =>
          Promise.all([
            fs.readFile(write),
            fs.readFile(edit),
            fs.readFile(patch),
            ...synced.map((item) => fs.readFile(item.path)),
          ]),
        )
        expect(bytes[0].equals(encoding.utf16("after"))).toBe(true)
        expect(bytes[1].equals(encoding.windows1251("Привет тест"))).toBe(true)
        expect(bytes[2].equals(encoding.bom("after\n"))).toBe(true)
        expect(bytes[3].equals(encoding.utf16("formatted"))).toBe(true)
        expect(bytes[4].equals(encoding.windows1251("formatted"))).toBe(true)
        expect(bytes[5].equals(encoding.bom("formatted"))).toBe(true)
      }),
    ),
  )

  it.live("preserves useful symlinks whose targets remain in the workspace", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const target = path.join(dir, "target")
        const link = path.join(dir, "link")
        yield* Effect.promise(async () => {
          await fs.mkdir(target)
          await fs.symlink(target, link)
        })
        yield* sandbox(profile(dir), runWrite({ filePath: path.join(link, "value.txt"), content: "linked" }))
        expect(yield* Effect.promise(() => fs.readFile(path.join(target, "value.txt"), "utf8"))).toBe("linked")
      }),
    ),
  )

  it.live("rejects background-process start and restart while sandboxed", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const start = yield* sandbox(profile(dir), runBackground({ action: "start", command: "sleep 30" }))
        const restart = yield* sandbox(
          profile(dir),
          runBackground({ action: "restart", id: BackgroundProcess.ID.ascending("bgp-test") }),
        )
        expect(start.output).toContain("unavailable while the sandbox is enabled")
        expect(restart.output).toContain("unavailable while the sandbox is enabled")
      }),
    ),
  )

  for (const destination of ["outside", ".git"] as const) {
    for (const tool of ["Write", "Edit", "ApplyPatch"] as const) {
      it.live(`${tool} cannot follow a racing parent into ${destination}`, () =>
        provideTmpdirInstance((dir) =>
          Effect.acquireUseRelease(
            Effect.promise(async () => {
              const ext = await outside(dir)
              const safe = path.join(dir, "safe")
              const protectedDir = destination === "outside" ? ext : path.join(dir, ".git", "race")
              const live = path.join(dir, "live")
              await fs.mkdir(path.join(dir, ".tmp"), { recursive: true })
              await fs.mkdir(safe, { recursive: true })
              await fs.mkdir(protectedDir, { recursive: true })
              await fs.writeFile(path.join(safe, "value.txt"), "before\n")
              await fs.writeFile(path.join(protectedDir, "value.txt"), "protected\n")
              await fs.symlink(safe, live)
              const swap = await attacker(dir, live, [protectedDir, safe])
              return { ext, live, protectedDir, swap }
            }),
            (setup) =>
              Effect.gen(function* () {
                gate.run = setup.swap.open
                const target = path.join(setup.live, "value.txt")
                const effect =
                  tool === "Write"
                    ? runWrite({ filePath: target, content: "escaped" }).pipe(Effect.asVoid)
                    : tool === "Edit"
                      ? runEdit({ filePath: target, oldString: "before", newString: "escaped" }).pipe(Effect.asVoid)
                      : runPatch(
                          "*** Begin Patch\n*** Update File: live/value.txt\n@@\n-before\n+escaped\n*** End Patch",
                        ).pipe(Effect.asVoid)
                yield* withRunner(runner, sandbox(profile(dir), effect)).pipe(Effect.exit)
                const protectedText = yield* Effect.promise(() =>
                  fs.readFile(path.join(setup.protectedDir, "value.txt"), "utf8"),
                )
                expect(protectedText).toBe("protected\n")
              }),
            (setup) =>
              Effect.promise(async () => {
                gate.run = undefined
                await setup.swap.close()
                await fs.rm(setup.ext, { recursive: true, force: true })
              }),
          ),
        ),
      )
    }
  }
})
