import { Bus } from "@/bus"
import { GlobalBus } from "@/bus/global"
import { BusEvent } from "@/bus/bus-event"
import { Provider } from "@/provider/provider"
import { InstanceBootstrap } from "@/project/bootstrap"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Vcs } from "@/project/vcs"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { Storage } from "@/storage/storage"
import { fn } from "@/util/fn"
import { Log } from "@/util/log"
import { Worktree } from "@/worktree"
import { $ } from "bun"
import path from "path"
import z from "zod"
import { AgentManagerTypes } from "./types"

export namespace AgentManagerService {
  const log = Log.create({ service: "agent-manager.service" })
  const MAX_PATCH = 12_000

  export const Event = {
    SessionCreated: BusEvent.define("agent-manager.session.created", AgentManagerTypes.CreatedEvent),
  }

  const Store = AgentManagerTypes.SessionRecord.array()
  type Store = AgentManagerTypes.SessionRecord[]

  function key() {
    return ["agent_manager", "session", Instance.project.id]
  }

  async function readStore(): Promise<Store> {
    const data = await Storage.read<Store>(key()).catch(() => [])
    return Store.parse(data)
  }

  async function writeStore(input: Store) {
    await Storage.write(key(), input)
  }

  function group() {
    return `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  }

  function worktreeID(name: string) {
    return `wt_${name}`
  }

  function toModel(input: z.infer<typeof AgentManagerTypes.ModelInput>) {
    if (!input) return
    if (typeof input === "string") return Provider.parseModel(input)
    return input
  }

  function modelText(input: { providerID: string; modelID: string } | undefined) {
    if (!input) return
    return `${input.providerID}/${input.modelID}`
  }

  function toStatus(input: SessionStatus.Info | undefined): AgentManagerTypes.Session["status"] {
    if (!input) return "idle"
    if (input.type === "busy" || input.type === "retry") return "busy"
    if (input.type === "idle") return "idle"
    return "error"
  }

  function parseCursor(input: string | undefined) {
    const value = Number.parseInt(input ?? "0", 10)
    if (!Number.isFinite(value) || value < 0) return 0
    return value
  }

  function parseLimit(input: number | undefined, fallback: number, max: number) {
    const value = input ?? fallback
    if (!Number.isFinite(value)) return fallback
    if (value < 1) return 1
    if (value > max) return max
    return Math.floor(value)
  }

  /**
   * Start listening for worktree ready/failed events BEFORE Worktree.create()
   * so we never miss the event if setTimeout(0) fires synchronously.
   * Call `.for(directory)` after Worktree.create() returns to resolve.
   */
  function waitForAnyReady(timeout = 120_000) {
    const resolved = new Map<string, true>()
    const failed = new Map<string, string>()
    const waiting = new Map<string, { resolve: () => void; reject: (err: Error) => void }>()

    const handler = (event: { directory?: string; payload: any }) => {
      const dir = event.directory
      if (!dir) return
      const type = event.payload?.type as string | undefined
      if (type === Worktree.Event.Ready.type) {
        resolved.set(dir, true)
        waiting.get(dir)?.resolve()
        waiting.delete(dir)
      }
      if (type === Worktree.Event.Failed.type) {
        const msg = event.payload.properties?.message ?? "Worktree bootstrap failed"
        failed.set(dir, msg)
        waiting.get(dir)?.reject(new Error(msg))
        waiting.delete(dir)
      }
    }
    GlobalBus.on("event", handler)

    return {
      for(directory: string): Promise<void> {
        // Already resolved before we asked
        if (resolved.has(directory)) {
          GlobalBus.off("event", handler)
          return Promise.resolve()
        }
        if (failed.has(directory)) {
          GlobalBus.off("event", handler)
          return Promise.reject(new Error(failed.get(directory)))
        }
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            GlobalBus.off("event", handler)
            waiting.delete(directory)
            reject(new Error(`Worktree ready timeout after ${timeout}ms: ${directory}`))
          }, timeout)
          waiting.set(directory, {
            resolve() {
              clearTimeout(timer)
              GlobalBus.off("event", handler)
              resolve()
            },
            reject(err) {
              clearTimeout(timer)
              GlobalBus.off("event", handler)
              reject(err)
            },
          })
        })
      },
    }
  }

  function variant(input: {
    create: AgentManagerTypes.CreateInput
    count: number
    idx: number
    item: z.infer<typeof AgentManagerTypes.Version>
  }) {
    const prompt = input.item.prompt?.trim() || input.create.prompt?.trim() || ""
    const label = input.item.label ?? (input.count > 1 ? `v${input.idx + 1}` : undefined)
    const model = toModel(input.item.model ?? input.create.model)
    const agent = input.item.agent ?? input.create.agent
    const base = input.item.name ?? input.item.label ?? input.create.name
    const name = base ? (input.count > 1 ? `${base}-${input.idx + 1}` : base) : undefined
    return {
      prompt,
      label,
      model,
      agent,
      name,
    }
  }

  async function statusFor(input: AgentManagerTypes.SessionRecord) {
    if (input.failed) return "error" as const
    return Instance.provide({
      directory: input.worktree.path,
      fn: () => toStatus(SessionStatus.get(input.sessionID)),
    }).catch(() => "error" as const)
  }

  async function asSession(input: { record: AgentManagerTypes.SessionRecord; session: Session.Info }) {
    const status = await statusFor(input.record)
    return AgentManagerTypes.Session.parse({
      sessionID: input.record.sessionID,
      groupID: input.record.groupID,
      worktree: input.record.worktree,
      title: input.session.title,
      agent: input.record.agent,
      model: input.record.model,
      label: input.record.label,
      status,
      summary: input.session.summary,
      time: input.session.time,
    })
  }

  function truncatePatch(input: string) {
    if (input.length <= MAX_PATCH) return { patch: input, patchTruncated: false }
    return { patch: input.slice(0, MAX_PATCH), patchTruncated: true }
  }

  async function trackedDiff(input: { ancestor: string; directory: string; includePatch: boolean }) {
    const nameStatus = await $`git -c core.quotepath=false diff --name-status --no-renames ${input.ancestor}`
      .cwd(input.directory)
      .quiet()
      .nothrow()
    if (nameStatus.exitCode !== 0) return [] as AgentManagerTypes.DiffFile[]

    const statsRaw = await $`git -c core.quotepath=false diff --numstat --no-renames ${input.ancestor}`
      .cwd(input.directory)
      .quiet()
      .nothrow()

    const stats = new Map<string, { additions: number; deletions: number }>()
    if (statsRaw.exitCode === 0) {
      for (const line of statsRaw.stdout.toString().trim().split("\n")) {
        if (!line) continue
        const parts = line.split("\t")
        const file = parts.slice(2).join("\t")
        if (!file) continue
        const additions = parts[0] === "-" ? 0 : Number.parseInt(parts[0] ?? "0", 10)
        const deletions = parts[1] === "-" ? 0 : Number.parseInt(parts[1] ?? "0", 10)
        stats.set(file, {
          additions: Number.isFinite(additions) ? additions : 0,
          deletions: Number.isFinite(deletions) ? deletions : 0,
        })
      }
    }

    const files: AgentManagerTypes.DiffFile[] = []
    for (const line of nameStatus.stdout.toString().trim().split("\n")) {
      if (!line) continue
      const parts = line.split("\t")
      const code = parts[0] ?? "M"
      const file = parts.slice(1).join("\t")
      if (!file) continue
      const kind = code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified"
      const entry = stats.get(file) ?? { additions: 0, deletions: 0 }
      const patch = await (async () => {
        if (!input.includePatch) return
        const raw = await $`git -c core.quotepath=false diff --no-renames ${input.ancestor} -- ${file}`
          .cwd(input.directory)
          .quiet()
          .nothrow()
        if (raw.exitCode !== 0) return
        const text = raw.stdout.toString()
        if (!text) return
        return truncatePatch(text)
      })()
      files.push(
        AgentManagerTypes.DiffFile.parse({
          path: file,
          status: kind,
          additions: entry.additions,
          deletions: entry.deletions,
          patch: patch?.patch,
          patchTruncated: patch?.patchTruncated,
        }),
      )
    }
    return files
  }

  async function untrackedDiff(input: { directory: string; includePatch: boolean; seen: Set<string> }) {
    const rows = await $`git ls-files --others --exclude-standard`.cwd(input.directory).quiet().nothrow()
    if (rows.exitCode !== 0) return [] as AgentManagerTypes.DiffFile[]

    const files: AgentManagerTypes.DiffFile[] = []
    for (const file of rows.stdout.toString().trim().split("\n")) {
      if (!file || input.seen.has(file)) continue
      const full = path.join(input.directory, file)
      const stats = await Bun.file(full)
        .stat()
        .catch(() => undefined)
      if (!stats?.isFile()) continue
      const text = await Bun.file(full)
        .text()
        .catch(() => "")
      const lines = text ? text.split("\n").length : 0
      const patch = (() => {
        if (!input.includePatch) return
        const body = text
          .split("\n")
          .map((line) => `+${line}`)
          .join("\n")
        const raw = `diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines} @@\n${body}`
        return truncatePatch(raw)
      })()
      files.push(
        AgentManagerTypes.DiffFile.parse({
          path: file,
          status: "added",
          additions: lines,
          deletions: 0,
          patch: patch?.patch,
          patchTruncated: patch?.patchTruncated,
        }),
      )
    }
    return files
  }

  async function allDiff(input: { record: AgentManagerTypes.SessionRecord; includePatch: boolean }) {
    const merge = await $`git merge-base HEAD ${input.record.worktree.baseBranch}`
      .cwd(input.record.worktree.path)
      .quiet()
      .nothrow()
    if (merge.exitCode !== 0) {
      log.warn("merge-base failed", {
        sessionID: input.record.sessionID,
        base: input.record.worktree.baseBranch,
        stderr: merge.stderr.toString().trim(),
      })
      return [] as AgentManagerTypes.DiffFile[]
    }
    const ancestor = merge.stdout.toString().trim()
    const tracked = await trackedDiff({
      ancestor,
      directory: input.record.worktree.path,
      includePatch: input.includePatch,
    })
    const seen = new Set(tracked.map((item) => item.path))
    const untracked = await untrackedDiff({
      directory: input.record.worktree.path,
      includePatch: input.includePatch,
      seen,
    })
    return [...tracked, ...untracked].toSorted((a, b) => a.path.localeCompare(b.path))
  }

  export const create = fn(AgentManagerTypes.CreateInput, async (input) => {
    const baseBranch = input.baseBranch ?? (await Vcs.branch()) ?? "main"
    const raw: z.infer<typeof AgentManagerTypes.Version>[] = input.versions?.length
      ? input.versions
      : [AgentManagerTypes.Version.parse({})]
    const variants = raw.map((item: z.infer<typeof AgentManagerTypes.Version>, idx: number) =>
      variant({ create: input, count: raw.length, idx, item }),
    )
    const missing = variants.filter((v) => !v.prompt)
    if (missing.length > 0) {
      throw new Error("Prompt is required. Provide a top-level prompt or ensure every version has its own prompt.")
    }
    const groupID = variants.length > 1 ? group() : undefined
    const store = await readStore()
    const sessions: AgentManagerTypes.Session[] = []

    for (const [idx, item] of variants.entries()) {
      // Register the ready listener BEFORE creating the worktree so we never
      // miss the event if setTimeout(0) fires before we subscribe.
      const pending = waitForAnyReady()
      const created = await Worktree.create({
        name: item.name,
        baseBranch,
      })

      // Worktree.create returns immediately with --no-checkout; the checkout
      // and InstanceBootstrap run asynchronously in a setTimeout. We must wait
      // for that to complete before calling Instance.provide — otherwise we
      // poison the Instance cache without running InstanceBootstrap.
      await pending.for(created.directory)

      const session = await Instance.provide({
        directory: created.directory,
        fn: () =>
          Session.create({
            platform: "agent-manager",
          }),
      })

      const record = AgentManagerTypes.SessionRecord.parse({
        sessionID: session.id,
        groupID,
        worktree: {
          id: worktreeID(created.name),
          path: created.directory,
          branch: created.branch,
          baseBranch,
        },
        agent: item.agent ?? "code",
        model: modelText(item.model),
        label: item.label,
        time: session.time,
      })

      store.push(record)

      void Instance.provide({
        directory: created.directory,
        async fn() {
          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: item.agent,
            model: item.model,
            parts: [
              {
                type: "text",
                text: item.prompt,
              },
            ],
          })
        },
      }).catch(async (error) => {
        log.error("failed to start managed session prompt", {
          sessionID: session.id,
          error,
        })
        const rows = await readStore().catch(() => [] as Store)
        const target = rows.find((r) => r.sessionID === session.id)
        if (target) {
          target.failed = true
          await writeStore(rows).catch(() => undefined)
        }
      })

      const output = AgentManagerTypes.Session.parse({
        sessionID: record.sessionID,
        groupID: record.groupID,
        worktree: record.worktree,
        title: session.title,
        agent: record.agent,
        model: record.model,
        label: record.label,
        status: "busy",
        summary: session.summary,
        time: session.time,
      })

      sessions.push(output)

      await Bus.publish(Event.SessionCreated, {
        sessionID: record.sessionID,
        groupID: record.groupID,
        worktree: record.worktree,
        model: record.model,
        label: record.label,
      })

      log.info("managed session created", {
        sessionID: record.sessionID,
        branch: record.worktree.branch,
        index: idx + 1,
        total: variants.length,
      })
    }

    await writeStore(store)
    return AgentManagerTypes.CreateOutput.parse({
      groupID,
      sessions,
    })
  })

  export const list = fn(AgentManagerTypes.ListInput.optional(), async (input) => {
    const query = AgentManagerTypes.ListInput.parse(input ?? {})
    const rows = await readStore()
    const sessions = [...Session.list()]
    const map = new Map(sessions.map((item) => [item.id, item]))
    const assembled = await Promise.all(
      rows.flatMap((record) => {
        const item = map.get(record.sessionID)
        if (!item) return []
        return [asSession({ record, session: item })]
      }),
    )

    const filteredByGroup = query.groupID
      ? assembled.filter((item: AgentManagerTypes.Session) => item.groupID === query.groupID)
      : assembled
    const filtered = query.status
      ? filteredByGroup.filter((item: AgentManagerTypes.Session) => item.status === query.status)
      : filteredByGroup
    const ordered = filtered.toSorted(
      (a: AgentManagerTypes.Session, b: AgentManagerTypes.Session) => b.time.updated - a.time.updated,
    )
    const start = parseCursor(query.cursor)
    const limit = parseLimit(query.limit, 50, 200)
    const list = ordered.slice(start, start + limit)
    const cursor = start + list.length < ordered.length ? String(start + list.length) : undefined
    return AgentManagerTypes.ListOutput.parse({
      sessions: list,
      cursor,
    })
  })

  export const get = fn(AgentManagerTypes.DetailInput, async (input) => {
    const rows = await readStore()
    const record = rows.find((item) => item.sessionID === input.sessionID)
    if (!record) throw new Error(`Managed session not found: ${input.sessionID}`)
    const session = await Session.get(input.sessionID)
    const info = await asSession({ record, session })
    const messages = await Session.messages({
      sessionID: input.sessionID,
      limit: parseLimit(input.limit, 50, 200),
    })
    return AgentManagerTypes.DetailOutput.parse({
      session: info,
      messages,
    })
  })

  export const cancel = fn(AgentManagerTypes.CancelInput, async (input) => {
    const rows = await readStore()
    const record = rows.find((item) => item.sessionID === input.sessionID)
    if (!record) throw new Error(`Managed session not found: ${input.sessionID}`)

    await Instance.provide({
      directory: record.worktree.path,
      fn: async () => {
        SessionPrompt.cancel(input.sessionID)
        await Worktree.remove({ directory: record.worktree.path }).catch(() => true)
      },
    }).catch(async () => {
      SessionPrompt.cancel(input.sessionID)
      await Worktree.remove({ directory: record.worktree.path }).catch(() => true)
    })

    await Project.removeSandbox(Instance.project.id, record.worktree.path).catch(() => undefined)
    await writeStore(rows.filter((item) => item.sessionID !== input.sessionID))
    return true
  })

  export const diff = fn(AgentManagerTypes.DiffInput, async (input) => {
    const rows = await readStore()
    const record = rows.find((item) => item.sessionID === input.sessionID)
    if (!record) throw new Error(`Managed session not found: ${input.sessionID}`)

    const files = await allDiff({
      record,
      includePatch: input.includePatch === true,
    })

    const start = parseCursor(input.cursor)
    const limit = parseLimit(input.limit, 20, 200)
    const page = files.slice(start, start + limit)
    const cursor = start + page.length < files.length ? String(start + page.length) : undefined
    const summary = {
      totalFiles: files.length,
      totalAdditions: files.reduce((sum, item) => sum + item.additions, 0),
      totalDeletions: files.reduce((sum, item) => sum + item.deletions, 0),
    }

    return AgentManagerTypes.DiffOutput.parse({
      files: page,
      summary,
      cursor,
    })
  })
}
