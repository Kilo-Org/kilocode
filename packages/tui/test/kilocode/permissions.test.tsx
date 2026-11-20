import { expect, test } from "bun:test"
import type { OpenCodeEvent, PermissionRequest } from "@opencode/client"
import { createAppFixture } from "../fixture/app"
import { directory, json } from "../fixture/tui-client"

const location = { directory, project: { id: "project", directory, canonical: directory } }
const sessionID = "ses_permissions"
const requestID = "per_permissions"
function permissionRequest(id: string): PermissionRequest {
  return {
    id: requestID,
    sessionID: id,
    action: "shell",
    resources: ["bun run check"],
  }
}
const kiloChecks = [
  "bun run test *",
  "bun run typecheck *",
  "bun run lint *",
  "bun run check *",
  "bun run build *",
  "bun test *",
  "bun typecheck *",
  "bun lint *",
  "bun check *",
  "bun build *",
  "bun run typecheck:tsc *",
  "bun typecheck:tsc *",
  "bun run check:architecture *",
  "bun run check:duplication *",
  "bun run check:generated *",
  "bun run lint:changed *",
  "bun script/kilocode/metrics/check.ts *",
] as const

const presets = [
  { id: "kilo-bun-checks", resources: kiloChecks },
  { id: "typescript-checks", resources: ["bun run test *"] },
  { id: "dependency-install", resources: ["bun install *", "bun add *", "bun i *", "tail *", "head *"] },
] as const

type State = {
  pending: boolean
  decision: "accepted" | "skipped" | null
  readonly clearOnApply?: boolean
  readonly applyFailure?: boolean
  readonly delayApply?: Promise<void>
  readonly delaySkip?: Promise<void>
  /** The sets that match the project now; every set by default. */
  readonly presets?: readonly (typeof presets)[number][]
  readonly unidentified?: boolean
  readonly applied: string[]
  skipped: number
  cleared: number
  readonly listLocations: string[]
  replyCalls: number
}

function state(overrides: Partial<State> = {}): State {
  return {
    pending: true,
    decision: null,
    applied: [],
    skipped: 0,
    cleared: 0,
    listLocations: [],
    replyCalls: 0,
    ...overrides,
  }
}

function sessionFetch(id: string, sessionLocation = location) {
  return async (url: URL) => {
    if (url.pathname === `/api/session/${id}`)
      return json({
        data: {
          id,
          projectID: sessionLocation.project.id,
          title: "Permission fixture",
          agent: "build",
          model: { providerID: "demo", id: "model" },
          location: { directory: sessionLocation.directory },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: 0, updated: 0 },
        },
      })
    if (url.pathname === `/api/session/${id}/message`) return json({ data: [], cursor: {} })
    if (url.pathname === `/api/session/${id}/inbox`) return json({ data: [] })
    if (url.pathname === "/api/agent")
      return json({
        location: sessionLocation,
        data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }],
      })
    if (url.pathname === "/api/provider")
      return json({ location: sessionLocation, data: [{ id: "demo", name: "Demo" }] })
    if (url.pathname === "/api/model")
      return json({
        location: sessionLocation,
        data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }],
      })
    return undefined
  }
}

function fixtureFetch(
  current: State,
  input?: { readonly sessionID?: string; readonly sessionLocation?: typeof location },
) {
  const id = input?.sessionID ?? sessionID
  const sessionLocation = input?.sessionLocation ?? location
  return async (url: URL, requestInput: Request) => {
    if (url.pathname === `/api/session/${id}/permission`) {
      return json({ data: current.pending ? [permissionRequest(id)] : [] })
    }
    if (url.pathname === "/api/permission/saved") return json({ data: [] })
    if (url.pathname.startsWith("/api/rpc/kilocode.permissions/")) {
      if (url.pathname.endsWith("/list")) {
        current.listLocations.push(decodeURIComponent(url.search))
        return json({
          output: {
            enabled: true,
            projectID: url.search.includes("child") ? "child-project" : sessionLocation.project.id,
            unidentified: current.unidentified ?? false,
            decision: current.decision,
            presets: current.presets ?? presets,
            applied: presets.filter((preset) => current.applied.includes(preset.id)),
          },
        })
      }
      if (url.pathname.endsWith("/apply")) {
        const body = (await requestInput.json()) as { input?: { presetID?: string } }
        if (body.input?.presetID) current.applied.push(body.input.presetID)
        if (current.delayApply) await current.delayApply
        if (current.applyFailure) return new Response("apply failed", { status: 500 })
        if (current.clearOnApply) current.pending = false
        current.decision = "accepted"
        return json({ output: {} })
      }
      if (url.pathname.endsWith("/skip")) {
        if (current.delaySkip) await current.delaySkip
        current.skipped += 1
        current.decision = "skipped"
        return json({ output: {} })
      }
      if (url.pathname.endsWith("/clear")) {
        current.cleared += 1
        current.applied.splice(0)
        current.decision = "skipped"
        return json({ output: {} })
      }
    }
    if (/^\/api\/session\/[^/]+\/permission\/[^/]+\/reply$/.test(url.pathname)) {
      current.replyCalls += 1
      return new Response(null, { status: 204 })
    }
    return sessionFetch(id, sessionLocation)(url)
  }
}

async function until(app: { captureCharFrame: () => string }, label: string, predicate: (frame: string) => boolean) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const frame = app.captureCharFrame()
    if (predicate(frame)) return frame
    await Bun.sleep(40)
  }
  throw new Error(`timed out waiting for ${label}:\n${app.captureCharFrame()}`)
}
async function pageUntil(
  app: { captureCharFrame: () => string; mockInput: { pressKey: (key: string) => void } },
  label: string,
  key: string,
) {
  for (let attempt = 0; attempt < 32; attempt++) {
    const frame = app.captureCharFrame()
    if (frame.includes(label)) return frame
    app.mockInput.pressKey(key)
    await Bun.sleep(40)
  }
  throw new Error(`timed out paging to ${label}:\n${app.captureCharFrame()}`)
}

const pageUp = "\u001b[5~"
const pageDown = "\u001b[6~"

function emitReplied(app: { events: { emit(event: OpenCodeEvent): void } }, id = requestID, session = sessionID) {
  app.events.emit({
    id: `evt_replied_${id}`,
    created: Date.now(),
    type: "permission.replied",
    data: { sessionID: session, requestID: id, reply: "once" },
  })
}

test("offers every preset, pages the bounded preview, and applies the final install resource at 100 columns", async () => {
  const current = state({ clearOnApply: true })
  await using app = await createAppFixture({
    width: 100,
    height: 34,
    args: { sessionID },
    config: { animations: false, tabs: { mode: "off" } },
    fetch: fixtureFetch(current),
  })
  await app.ready
  const first = await until(app, "permission offer", (frame) => frame.includes("Set up project permissions"))
  for (const label of ["Kilo / Bun checks", "TypeScript checks", "Dependency installs"]) {
    expect(first).toContain(label)
  }

  app.mockInput.pressKey("j")
  app.mockInput.pressKey("j")
  await until(app, "install preset", (frame) => frame.includes("● Dependency installs"))
  const final = await pageUntil(app, "bun add *", pageDown)
  expect(final).toContain("bun add *")
  const trust = await pageUntil(
    app,
    "Project scripts can execute repository code. Existing deny rules still apply.",
    pageDown,
  )
  expect(trust).toContain("Project scripts can execute repository code. Existing deny rules still apply.")
  const warnings = await pageUntil(app, "Dependency installation can download and execute package code.", pageDown)
  expect(warnings).toContain("Dependency installation can download and execute package code.")
  expect(warnings).toContain("Apply")
  expect(warnings).toContain("Skip")

  const previous = await pageUntil(app, "bun install *", pageUp)
  expect(previous).toContain("bun install *")
  const finalAgain = await pageUntil(app, "bun add *", pageDown)
  expect(finalAgain).toContain("bun add *")

  app.mockInput.pressEnter()
  await until(app, "offer completion", (frame) => !frame.includes("Set up project permissions"))
  expect(current.applied).toEqual(["dependency-install"])
  expect(current.replyCalls).toBe(0)
})

test("skip, Escape, duplicate input, and late request removal release the normal prompt at 60 columns", async () => {
  const skip = Promise.withResolvers<void>()
  const current = state({ delaySkip: skip.promise })
  await using app = await createAppFixture({
    width: 60,
    height: 30,
    args: { sessionID },
    config: { animations: false, tabs: { mode: "off" } },
    fetch: fixtureFetch(current),
  })
  await app.ready
  const narrow = await until(app, "narrow permission offer", (frame) => frame.includes("Set up project permissions"))
  expect(narrow).toContain("Apply")
  expect(narrow).toContain("Skip")
  app.mockInput.pressEscape()
  app.mockInput.pressEscape()
  app.mockInput.pressEnter()
  await until(app, "applying status", (frame) => frame.includes("Applying project permissions…"))
  await app.mockMouse.click(1, 1)
  skip.resolve()
  await until(app, "normal prompt", (frame) => frame.includes("Permission required"))
  expect(current.skipped).toBe(1)
  expect(current.replyCalls).toBe(0)
})

test("accepted projects bypass the automatic offer, while /permissions reopens the chooser", async () => {
  const accepted = state({ pending: true, decision: "accepted" })
  await using acceptedApp = await createAppFixture({
    width: 100,
    height: 34,
    args: { sessionID },
    config: { animations: false, tabs: { mode: "off" } },
    fetch: fixtureFetch(accepted),
  })
  await acceptedApp.ready
  await until(acceptedApp, "normal prompt", (frame) => frame.includes("Permission required"))
  expect(acceptedApp.captureCharFrame()).not.toContain("Set up project permissions")

  const manual = state({ pending: false, decision: "accepted" })
  await using manualApp = await createAppFixture({
    width: 100,
    height: 34,
    args: { sessionID: "ses_permissions_manual" },
    config: { animations: false, tabs: { mode: "off" } },
    fetch: fixtureFetch(manual, { sessionID: "ses_permissions_manual" }),
  })
  await manualApp.ready
  await until(manualApp, "composer", (frame) => frame.includes("ctrl+p commands"))
  await manualApp.mockInput.typeText("/permissions")
  await until(manualApp, "permission command", (frame) =>
    frame.includes("Choose development permissions to add to this project"),
  )
  await Bun.sleep(0)
  manualApp.mockInput.pressEnter()
  await until(manualApp, "manual permission chooser", (frame) => frame.includes("Apply Kilo / Bun checks"))
  manualApp.mockInput.pressEscape()
  await until(manualApp, "manual chooser close", (frame) => !frame.includes("Apply Kilo / Bun checks"))
  // Dismissing the chooser records nothing.
  expect(manual.skipped).toBe(0)
  expect(manual.decision).toBe("accepted")

  // The chooser opens again after a dismissal in the same session.
  await manualApp.mockInput.typeText("/permissions")
  await until(manualApp, "permission command again", (frame) =>
    frame.includes("Choose development permissions to add to this project"),
  )
  await Bun.sleep(0)
  manualApp.mockInput.pressEnter()
  const reopened = await until(manualApp, "manual permission chooser again", (frame) =>
    frame.includes("Apply Kilo / Bun checks"),
  )
  expect(reopened).toContain("Install and add package dependencies")
})

test("an uncovered apply keeps the authoritative normal prompt and reports RPC failure without replying", async () => {
  const current = state()
  await using app = await createAppFixture({
    width: 100,
    height: 34,
    args: { sessionID },
    config: { animations: false, tabs: { mode: "off" } },
    fetch: fixtureFetch(current),
  })
  await app.ready
  await until(app, "permission offer", (frame) => frame.includes("Set up project permissions"))
  app.mockInput.pressEnter()
  await until(app, "normal prompt after uncovered apply", (frame) => frame.includes("Permission required"))
  expect(current.replyCalls).toBe(0)

  const failedApply = Promise.withResolvers<void>()
  const failed = state({ applyFailure: true, delayApply: failedApply.promise })
  await using failureApp = await createAppFixture({
    width: 100,
    height: 34,
    args: { sessionID: "ses_permissions_failure" },
    config: { animations: false, tabs: { mode: "off" } },
    fetch: fixtureFetch(failed, { sessionID: "ses_permissions_failure" }),
  })
  await failureApp.ready
  await until(failureApp, "failure offer", (frame) => frame.includes("Set up project permissions"))
  failureApp.mockInput.pressEnter()
  await until(failureApp, "failed applying status", (frame) => frame.includes("Applying project permissions…"))
  failed.pending = false
  emitReplied(failureApp, requestID, "ses_permissions_failure")
  failedApply.resolve()
  await until(failureApp, "failed offer released", (frame) => !frame.includes("Set up project permissions"))
  expect(failed.replyCalls).toBe(0)
})

test("routes child-session permission setup through the child location", async () => {
  const childDirectory = "/tmp/opencode-child"
  const childLocation = {
    directory: childDirectory,
    project: { id: "child-project", directory: childDirectory, canonical: childDirectory },
  }
  const current = state()
  await using app = await createAppFixture({
    width: 100,
    height: 34,
    args: { sessionID: "ses_child_permissions" },
    config: { animations: false, tabs: { mode: "off" } },
    fetch: fixtureFetch(current, { sessionID: "ses_child_permissions", sessionLocation: childLocation }),
  })
  await app.ready
  await until(app, "child permission offer", (frame) => frame.includes("Set up project permissions"))
  expect(current.listLocations.some((value) => value.includes("opencode-child"))).toBe(true)
})

test("does not start a second decision when the original request disappears during apply", async () => {
  const apply = Promise.withResolvers<void>()
  const current = state({ delayApply: apply.promise })
  await using app = await createAppFixture({
    width: 100,
    height: 34,
    args: { sessionID },
    config: { animations: false, tabs: { mode: "off" } },
    fetch: fixtureFetch(current),
  })
  await app.ready
  await until(app, "permission offer", (frame) => frame.includes("Set up project permissions"))
  app.mockInput.pressEnter()
  await until(app, "applying status", (frame) => frame.includes("Applying project permissions…"))
  current.pending = false
  emitReplied(app)
  apply.resolve()
  await until(app, "request gone", (frame) => !frame.includes("Set up project permissions"))
  expect(current.applied).toHaveLength(1)
  expect(current.replyCalls).toBe(0)
})

test("the sidebar lists the applied sets, and /permissions (None) removes them", async () => {
  const current = state({ pending: false, decision: "accepted", applied: ["typescript-checks"] })
  await using app = await createAppFixture({
    width: 160,
    height: 40,
    args: { sessionID },
    config: { animations: false, tabs: { mode: "off" } },
    fetch: fixtureFetch(current),
  })
  await app.ready
  const frame = await until(app, "sidebar permission sets", (value) => value.includes("Permission sets"))
  expect(frame).toContain("TypeScript checks")

  await until(app, "composer", (value) => value.includes("ctrl+p commands"))
  await app.mockInput.typeText("/permissions")
  await until(app, "permission command", (value) =>
    value.includes("Choose development permissions to add to this project"),
  )
  await Bun.sleep(0)
  app.mockInput.pressEnter()
  const chooser = await until(app, "manual chooser", (value) => value.includes("(None)"))
  expect(chooser).toContain("Applied")
  await app.mockInput.typeText("None")
  await until(app, "filtered chooser", (value) => !value.includes("Apply Kilo / Bun checks"))
  app.mockInput.pressEnter()
  // The chooser covers part of the sidebar, so wait for the clear itself before checking the sidebar.
  await until(app, "clear request", () => current.cleared > 0)
  await until(app, "sidebar cleared", (value) => !value.includes("Permission sets"))
  expect(current.cleared).toBe(1)
  expect(current.skipped).toBe(0)
  expect(current.applied).toEqual([])
})

test("auto-approve alone shows no permission sets in the sidebar", async () => {
  const current = state({ pending: false, decision: "skipped" })
  await using app = await createAppFixture({
    width: 160,
    height: 40,
    args: { sessionID, auto: true },
    config: { animations: false, tabs: { mode: "off" } },
    fetch: fixtureFetch(current),
  })
  await app.ready
  await until(
    app,
    "sidebar checked the project",
    (value) => value.includes("ctrl+p commands") && current.listLocations.length > 0,
  )
  await Bun.sleep(100)
  expect(app.captureCharFrame()).not.toContain("Permission sets")
})

test("/permissions offers (None) only while a set is applied", async () => {
  const current = state({ pending: false, decision: "skipped" })
  await using app = await createAppFixture({
    width: 100,
    height: 34,
    args: { sessionID },
    config: { animations: false, tabs: { mode: "off" } },
    fetch: fixtureFetch(current),
  })
  await app.ready
  await until(app, "composer", (value) => value.includes("ctrl+p commands"))
  await app.mockInput.typeText("/permissions")
  await until(app, "permission command", (value) =>
    value.includes("Choose development permissions to add to this project"),
  )
  await Bun.sleep(0)
  app.mockInput.pressEnter()
  const chooser = await until(app, "manual chooser", (value) => value.includes("Apply Kilo / Bun checks"))
  expect(chooser).not.toContain("(None)")
  expect(chooser).not.toContain("Permission sets")
})

async function openManualChooser(app: Awaited<ReturnType<typeof createAppFixture>>, label: string) {
  await app.mockInput.typeText("/permissions")
  await until(app, "permission command", (value) =>
    value.includes("Choose development permissions to add to this project"),
  )
  await Bun.sleep(0)
  app.mockInput.pressEnter()
  return until(app, label, (value) => value.includes(label))
}

test("/permissions shows a set's shell patterns and warnings before applying, and cancelling applies nothing", async () => {
  const current = state({ pending: false, decision: "skipped" })
  await using app = await createAppFixture({
    width: 100,
    height: 60,
    args: { sessionID },
    config: { animations: false, tabs: { mode: "off" } },
    fetch: fixtureFetch(current),
  })
  await app.ready
  await until(app, "composer", (value) => value.includes("ctrl+p commands"))
  await openManualChooser(app, "Apply Kilo / Bun checks")
  app.mockInput.pressEnter()
  const review = await until(app, "set review", (value) =>
    value.includes("Project scripts can execute repository code"),
  )
  expect(review).toContain("bun run check:architecture *")
  expect(review).toContain("tail, head and grep only filter command output")
  expect(review).toContain("Cancel")
  app.mockInput.pressEscape()
  await until(app, "review closed", (value) => !value.includes("Project scripts can execute repository code"))
  expect(current.applied).toEqual([])

  await openManualChooser(app, "Apply Kilo / Bun checks")
  app.mockInput.pressEnter()
  await until(app, "set review again", (value) => value.includes("Project scripts can execute repository code"))
  app.mockInput.pressEnter()
  await until(app, "apply request", () => current.applied.length > 0)
  expect(current.applied).toEqual(["kilo-bun-checks"])
})

test("/permissions still removes an applied set after the project stops matching", async () => {
  const current = state({ pending: false, decision: "accepted", presets: [], applied: ["typescript-checks"] })
  await using app = await createAppFixture({
    width: 100,
    height: 34,
    args: { sessionID },
    config: { animations: false, tabs: { mode: "off" } },
    fetch: fixtureFetch(current),
  })
  await app.ready
  await until(app, "composer", (value) => value.includes("ctrl+p commands"))
  const chooser = await openManualChooser(app, "(None)")
  expect(chooser).not.toContain("Apply Kilo / Bun checks")
  expect(chooser).not.toContain("No permission defaults match this project.")
  await app.mockInput.typeText("None")
  app.mockInput.pressEnter()
  await until(app, "clear request", () => current.cleared > 0)
  expect(current.applied).toEqual([])
})

test("a repository without its own project identity gets no offer, and /permissions says why", async () => {
  const pending = state({ unidentified: true, presets: [] })
  await using offerApp = await createAppFixture({
    width: 100,
    height: 34,
    args: { sessionID },
    config: { animations: false, tabs: { mode: "off" } },
    fetch: fixtureFetch(pending),
  })
  await offerApp.ready
  await until(offerApp, "normal prompt", (value) => value.includes("Permission required"))
  expect(offerApp.captureCharFrame()).not.toContain("Set up project permissions")

  const manual = state({ pending: false, unidentified: true, presets: [] })
  await using app = await createAppFixture({
    width: 100,
    height: 34,
    args: { sessionID: "ses_permissions_unidentified" },
    config: { animations: false, tabs: { mode: "off" } },
    fetch: fixtureFetch(manual, { sessionID: "ses_permissions_unidentified" }),
  })
  await app.ready
  await until(app, "composer", (value) => value.includes("ctrl+p commands"))
  await openManualChooser(app, "This repository has no commit or remote yet")
  expect(manual.applied).toEqual([])
})
