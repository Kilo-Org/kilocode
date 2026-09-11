import { afterEach, describe, expect, it } from "bun:test"
import { build } from "esbuild"
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { AnnotationStore } from "../../src/kilo-provider/annotation-store"
import { createAnnotationHandler } from "../../src/kilo-provider/annotations"
import { type AnnotationReply, type AnnotationRequest, validAnnotation } from "../../src/shared/annotations"
import { createAnnotationBridge } from "../../webview-ui/src/utils/annotation-bridge"
import { newAnnotation, withAnnotationComment } from "../../webview-ui/src/utils/annotations"

const roots: string[] = []
const cleanup: (() => void)[] = []
const setup = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kilo-annotation-test-"))
  roots.push(root)
  return { root, store: new AnnotationStore(root) }
}
const note = (sessionID = "ses_a") =>
  newAnnotation({ sessionID, messageID: "msg_a", selectedText: "owned text", comment: "comment", now: 1 })
afterEach(async () => {
  cleanup.splice(0).forEach((dispose) => dispose())
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("durable source annotation numbering", () => {
  it("allocates #1/#2, keeps edits stable, deletes then #3, restarts then #4", async () => {
    const { root, store } = await setup()
    const first = (await store.save(note())).items[0]!
    expect(first.number).toBe(1)
    const second = (await store.save(note())).items[1]!
    expect(second.number).toBe(2)
    const edited = await store.save(withAnnotationComment(first, "edited", 2))
    expect(edited.items[0]).toMatchObject({ id: first.id, number: 1, comment: "edited" })
    await store.remove("ses_a", [first.id, second.id])
    expect((await store.save(note())).items[0]!.number).toBe(3)
    expect((await new AnnotationStore(root).save(note())).items[1]!.number).toBe(4)
    expect((await store.save(note("ses_b"))).items[0]!.number).toBe(1)
  })

  it("serializes concurrent independent host instances and idempotent replay", async () => {
    const { root, store } = await setup()
    const item = note()
    await Promise.all(Array.from({ length: 12 }, () => new AnnotationStore(root).save(item)))
    expect((await store.load("ses_a")).items).toHaveLength(1)
    await Promise.all(Array.from({ length: 12 }, () => new AnnotationStore(root).save(note())))
    const result = await store.load("ses_a")
    expect(result.items.map((item) => item.number).sort((a, b) => a! - b!)).toEqual(
      Array.from({ length: 13 }, (_, index) => index + 1),
    )
    expect((await store.save(result.items[0]!)).revision).toBe(result.revision)
  })

  it("does not remap imported numbers or resurrect deleted UUIDs", async () => {
    const { store } = await setup()
    const first = (await store.save(note())).items[0]!
    await expect(store.save({ ...first, number: 9 })).rejects.toThrow("does not match")
    await expect(store.save({ ...first, sessionID: "ses_b" })).rejects.toThrow("not remapped")
    await store.remove("ses_a", [first.id])
    await expect(store.save(first)).rejects.toThrow("deleted in another pane")
    expect((await store.load("ses_b")).items).toEqual([])
  })

  it("reclaims the session quota for tombstones and garbage-collects the oldest", async () => {
    const { root, store } = await setup()
    const sessions: Record<string, unknown> = {}
    for (let index = 0; index < 4100; index++)
      sessions[`ses_old_${index}`] = { high: 1, revision: index, deleted: true, items: [], removed: {} }
    await mkdir(path.join(root, "annotations"), { recursive: true })
    await writeFile(path.join(root, "annotations", "records-v1.json"), JSON.stringify({ version: 1, sessions }))
    await store.deleteSession("ses_new")
    const state = JSON.parse(await readFile(path.join(root, "annotations", "records-v1.json"), "utf8"))
    expect(Object.keys(state.sessions)).toHaveLength(4096)
    expect(state.sessions["ses_new"]).toMatchObject({ deleted: true })
    expect(state.sessions["ses_old_0"]).toBeUndefined()
    expect(state.sessions["ses_old_4"]).toBeUndefined()
    expect(state.sessions["ses_old_5"]).toBeDefined()
    expect(state.sessions["ses_old_4099"]).toBeDefined()
    expect((await store.save(note())).items[0]!.number).toBe(1)
  })

  it("allocates without collisions across separate host processes and restarts", async () => {
    const { root, store } = await setup()
    const bundle = await build({
      entryPoints: [path.resolve(import.meta.dir, "../fixtures/annotation-store-worker.ts")],
      platform: "node",
      format: "cjs",
      target: "node22",
      bundle: true,
      write: false,
    })
    const file = path.join(root, "annotation-node-worker.cjs")
    await writeFile(file, bundle.outputFiles[0]!.contents)
    const worker = (id: string) => {
      const child = Bun.spawn(["node", file, root, id], { stdout: "pipe", stderr: "pipe" })
      return child.exited.then(async (code) => {
        expect(code, await new Response(child.stderr).text()).toBe(0)
        return Number((await new Response(child.stdout).text()).trim())
      })
    }
    const numbers = await Promise.all(Array.from({ length: 3 }, () => worker(crypto.randomUUID())))
    expect(numbers.sort()).toEqual([1, 2, 3])
    const id = crypto.randomUUID()
    expect(await Promise.all(Array.from({ length: 3 }, () => worker(id)))).toEqual([4, 4, 4])
    expect(await worker(crypto.randomUUID())).toBe(5)
    expect((await store.load("ses_a")).items).toHaveLength(5)
  }, 60_000)

  it("cleans text on explicit session deletion and prevents late writes", async () => {
    const { store } = await setup()
    const first = (await store.save(note())).items[0]!
    await store.deleteSession("ses_a")
    expect((await store.load("ses_a")).items).toEqual([])
    await expect(store.save(first)).rejects.toThrow("source conversation was deleted")
    expect(await readFile(store.file, "utf8")).not.toContain("owned text")
    expect((await store.save(note("ses_b"))).items[0]!.number).toBe(1)
  })

  it("preserves corrupt storage, exposes write failures and does not consume failed numbers", async () => {
    const { root, store } = await setup()
    await mkdir(store.directory)
    await writeFile(store.file, "not json")
    await expect(store.save(note())).rejects.toThrow()
    expect(await readFile(store.file, "utf8")).toBe("not json")
    const blocked = path.join(root, "not-a-directory")
    await writeFile(blocked, "blocked")
    await expect(new AnnotationStore(blocked).save(note())).rejects.toThrow()
    const fresh = new AnnotationStore(path.join(root, "fresh"))
    expect((await fresh.save(note())).items[0]!.number).toBe(1)
  })

  it("bounds storage visibly rather than evicting existing records", async () => {
    const { store } = await setup()
    const first = (await store.save(note())).items[0]!
    const original = JSON.parse(await readFile(store.file, "utf8"))
    const session = original.sessions.ses_a
    session.items = Array.from({ length: 1000 }, (_, index) => ({
      ...first,
      id: crypto.randomUUID(),
      number: index + 1,
    }))
    session.high = 1000
    await writeFile(store.file, JSON.stringify(original))
    const before = await readFile(store.file, "utf8")
    await expect(store.save(note())).rejects.toThrow("1,000 annotation marks")
    expect(await readFile(store.file, "utf8")).toBe(before)
  })

  it("persists only the annotation allowlist, not extra resolved data", async () => {
    const { store } = await setup()
    await store.save({
      ...note(),
      credentials: "not-a-real-secret",
      resolvedFile: "private file contents",
    } as ReturnType<typeof note>)
    const text = await readFile(store.file, "utf8")
    expect(text).not.toContain("credentials")
    expect(text).not.toContain("private file contents")
    expect(validAnnotation({ ...note(), selectedText: 4, anchor: {} })).toBe(false)
  })
})

describe("actual host/webview annotation bridge", () => {
  async function pane(root: string) {
    const listeners = new Set<(message: AnnotationReply | { type: string }) => void>()
    const changes: AnnotationReply[] = []
    const handler = createAnnotationHandler({
      storage: () => root,
      post: (message) => {
        changes.push(message)
        for (const listener of listeners) listener(message)
      },
    })
    const bridge = createAnnotationBridge({
      postMessage: (message) => {
        handler.handle(message)
      },
      onMessage: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    })
    cleanup.push(() => {
      bridge.dispose()
      handler.dispose()
    })
    return { bridge, changes }
  }

  it("persists via the real handler and broadcasts another pane's save/delete", async () => {
    const { root } = await setup()
    const bundle = await build({
      entryPoints: [path.resolve(import.meta.dir, "../fixtures/annotation-watch-worker.ts")],
      platform: "node",
      format: "cjs",
      target: "node22",
      bundle: true,
      write: false,
    })
    const file = path.join(root, "annotation-node-watch.cjs")
    await writeFile(file, bundle.outputFiles[0]!.contents)
    const child = Bun.spawnSync(["node", file, root], { stdout: "pipe", stderr: "pipe", timeout: 30_000 })
    expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0)
  })

  it("rejects host storage errors through the real bridge", async () => {
    const { root } = await setup()
    const blocked = path.join(root, "file")
    await writeFile(blocked, "no directory")
    const { bridge } = await pane(blocked)
    await expect(bridge.save(note())).rejects.toThrow()
  })

  it("ignores replies for another source scope and reports missing acknowledgements", async () => {
    let receive!: (message: AnnotationReply | { type: string }) => void
    let sent!: AnnotationRequest
    const bridge = createAnnotationBridge({
      timeout: 10,
      postMessage: (message) => {
        sent = message
      },
      onMessage: (callback) => {
        receive = callback
        return () => {}
      },
    })
    cleanup.push(bridge.dispose)
    const result = bridge.save(note())
    receive({ type: "annotationRecords", requestID: sent.requestID, sessionID: "ses_other", revision: 1, items: [] })
    await expect(result).rejects.toThrow("draft is preserved")
  })
})
