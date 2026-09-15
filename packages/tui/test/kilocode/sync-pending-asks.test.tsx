/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { GlobalEvent, PermissionRequest, QuestionRequest, Session } from "@kilocode/sdk/v2"
import { tmpdir } from "../fixture/fixture"
import { json, mount, wait } from "../cli/cmd/tui/sync-fixture"

const directory = "/tmp/opencode/packages/tui"
const parentID = "ses_parent"
const childID = "ses_child"

const parent: Session = {
  id: parentID,
  slug: "parent",
  title: "parent",
  projectID: "proj_test",
  directory,
  version: "7.5.15",
  time: { created: 1, updated: 1 },
}

const child: Session = {
  id: childID,
  slug: "child",
  title: "child",
  projectID: "proj_test",
  directory,
  version: "7.5.15",
  parentID,
  time: { created: 2, updated: 2 },
}

function permission(id: string, sessionID = childID): PermissionRequest {
  return {
    id,
    sessionID,
    permission: "edit",
    patterns: ["src/**"],
    metadata: {},
    always: [],
  }
}

function question(id: string, sessionID = childID): QuestionRequest {
  return {
    id,
    sessionID,
    questions: [{ question: "Proceed?", header: "Proceed", options: [{ label: "Yes", description: "" }] }],
  }
}

function wrap(payload: GlobalEvent["payload"]): GlobalEvent {
  return { directory, project: "proj_test", payload }
}

function serveSessions(sessions: Session[], asks: () => { permission?: PermissionRequest[]; question?: QuestionRequest[] }) {
  return (url: URL) => {
    if (url.pathname === "/session") return json(sessions)
    for (const session of sessions) {
      if (url.pathname === `/session/${session.id}`) return json(session)
      if (url.pathname === `/session/${session.id}/message`) return json([])
      if (url.pathname === `/session/${session.id}/todo` || url.pathname === `/session/${session.id}/diff`) return json([])
    }
    if (url.pathname === "/permission") return json(asks().permission ?? [])
    if (url.pathname === "/question") return json(asks().question ?? [])
    return undefined
  }
}

test("evicting a parent session keeps pending child permission and question asks", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const { app, emit, sync } = await mount(serveSessions([parent, child], () => ({})), tmp.path)

  try {
    emit(wrap({ id: "evt_ask", type: "permission.asked", properties: permission("per_1") }))
    emit(wrap({ id: "evt_question", type: "question.asked", properties: question("que_1") }))
    await wait(() => (sync.data.permission[childID] ?? []).length === 1)
    await wait(() => (sync.data.question[childID] ?? []).length === 1)

    sync.session.evict(parentID)

    expect(sync.data.permission[childID]).toHaveLength(1)
    expect(sync.data.question[childID]).toHaveLength(1)

    sync.session.evict(childID)

    expect(sync.data.permission[childID]).toHaveLength(1)
    expect(sync.data.question[childID]).toHaveLength(1)

    emit(
      wrap({ id: "evt_replied", type: "permission.replied", properties: { sessionID: childID, requestID: "per_1", reply: "once" } }),
    )
    emit(
      wrap({
        id: "evt_qreplied",
        type: "question.replied",
        properties: { sessionID: childID, requestID: "que_1", answers: [] },
      }),
    )
    await wait(() => (sync.data.permission[childID] ?? []).length === 0)
    await wait(() => (sync.data.question[childID] ?? []).length === 0)
  } finally {
    app.renderer.destroy()
  }
})

test("session sync refetches pending permission and question asks and drops stale ones", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  let pending = { permission: [permission("per_1")], question: [question("que_1")] }
  const { app, sync } = await mount(serveSessions([parent, child], () => pending), tmp.path)

  try {
    // Eviction no longer wipes the asks; simulate losing them anyway (e.g. the
    // ask arrived while the SSE stream was briefly down) and resync.
    sync.set("permission", { [childID]: [] })
    sync.set("question", { [childID]: [] })
    await sync.session.sync(childID)

    expect(sync.data.permission[childID]).toHaveLength(1)
    expect(sync.data.question[childID]).toHaveLength(1)

    // A later sync with no pending asks drops the stale entries.
    pending = { permission: [], question: [] }
    await sync.session.sync(parentID)

    expect(sync.data.permission[childID]).toBeUndefined()
    expect(sync.data.question[childID]).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("an ask arriving while the pending refetch is in flight survives it", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  let resolveSecond!: (value: PermissionRequest[]) => void
  const second = new Promise<PermissionRequest[]>((resolve) => {
    resolveSecond = resolve
  })
  let seen = 0
  const { app, emit, sync } = await mount(
    (url) => {
      if (url.pathname === "/permission") {
        seen += 1
        // bootstrap consumes the first list call; the session sync holds the second
        return seen === 1 ? json([]) : second.then((data) => json(data))
      }
      return serveSessions([parent, child], () => ({}))(url)
    },
    tmp.path,
  )

  try {
    // The store starts empty (e.g. the ask raced the SSE stream).
    sync.set("permission", { [childID]: [] })
    const hydrate = sync.session.sync(childID)
    await wait(() => seen === 2)
    // The server list resolves with no pending asks, but the live ask event
    // lands while the refetch is still settling.
    resolveSecond([])
    emit(wrap({ id: "evt_ask", type: "permission.asked", properties: permission("per_1") }))
    await hydrate

    expect(sync.data.permission[childID]).toHaveLength(1)
  } finally {
    app.renderer.destroy()
  }
})

test("an ask answered while the pending refetch is in flight is not resurrected", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  let resolveSecond!: (value: PermissionRequest[]) => void
  const second = new Promise<PermissionRequest[]>((resolve) => {
    resolveSecond = resolve
  })
  let seen = 0
  const { app, emit, sync } = await mount(
    (url) => {
      if (url.pathname === "/permission") {
        seen += 1
        // bootstrap consumes the first list call; the session sync holds the second
        return seen === 1 ? json([]) : second.then((data) => json(data))
      }
      return serveSessions([parent, child], () => ({}))(url)
    },
    tmp.path,
  )

  try {
    // The store holds a pending ask; the refetch starts while it is still live.
    sync.set("permission", { [childID]: [permission("per_1")] })
    const hydrate = sync.session.sync(childID)
    await wait(() => seen === 2)
    // The ask is answered while the (stale) server list is still in flight.
    emit(
      wrap({
        id: "evt_replied",
        type: "permission.replied",
        properties: { sessionID: childID, requestID: "per_1", reply: "once" },
      }),
    )
    resolveSecond([permission("per_1")])
    await hydrate

    // The stale list must not resurrect the answered ask.
    expect(sync.data.permission[childID]).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})

test("a failed pending list fetch keeps existing asks", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  let seen = 0
  const { app, sync } = await mount(
    (url) => {
      if (url.pathname === "/permission") {
        seen += 1
        // bootstrap consumes the first list call; the session sync gets a 500
        return seen === 1 ? json([]) : json({ message: "boom" }, { status: 500 })
      }
      return serveSessions([parent, child], () => ({}))(url)
    },
    tmp.path,
  )

  try {
    // A live ask is in the store; the refetch then fails.
    sync.set("permission", { [childID]: [permission("per_1")] })
    const hydrate = sync.session.sync(childID)
    await wait(() => seen === 2)
    await hydrate

    // The failed fetch must not merge an empty list over the live ask.
    expect(sync.data.permission[childID]).toHaveLength(1)
  } finally {
    app.renderer.destroy()
  }
})
