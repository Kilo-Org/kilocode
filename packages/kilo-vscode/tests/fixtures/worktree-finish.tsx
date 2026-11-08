import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { AgentManagerSidebarTarget, WorktreeState } from "../../webview-ui/src/types/messages"
import type { WorktreeDelete } from "../../webview-ui/agent-manager/worktree-delete"

const window = new Window({ url: "http://localhost" })
Object.defineProperty(window, "origin", { value: window.location.origin })
Object.assign(globalThis, {
  window,
  document: window.document,
  navigator: window.navigator,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  HTMLButtonElement: window.HTMLButtonElement,
  MutationObserver: window.MutationObserver,
  ResizeObserver: window.ResizeObserver,
  IntersectionObserver: window.IntersectionObserver,
  CustomEvent: window.CustomEvent,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  MessageEvent: window.MessageEvent,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  acquireVsCodeApi: () => ({ postMessage() {}, getState() {}, setState() {} }),
})

const { render } = await import("solid-js/web")
const { createSignal, For } = await import("solid-js")
const { VSCodeProvider } = await import("../../webview-ui/src/context/vscode")
const { LanguageProvider } = await import("../../webview-ui/src/context/language")
const { WorktreeItem } = await import("../../webview-ui/agent-manager/WorktreeItem")
const { createWorktreeCompletion } = await import("../../webview-ui/agent-manager/worktree-completion")
const { createWorktreeDelete } = await import("../../webview-ui/agent-manager/worktree-delete")
const { createProjectStore } = await import("../../webview-ui/agent-manager/project/store")
const { post: message } = await import("../../webview-ui/src/utils/webview-message")
const root = document.createElement("div")
document.body.append(root)
let deletion: WorktreeDelete
const pending = () => deletion.pending()?.projectId === project() && deletion.pending()?.worktreeId === worktree.id
const [busy, setBusy] = createSignal(false)
const worktree: WorktreeState = {
  id: "wt-test",
  branch: "task",
  parentBranch: "main",
  path: "/test/task",
  createdAt: "2026-09-07T00:00:00Z",
}
const sibling: WorktreeState = { ...worktree, id: "wt-sibling", branch: "sibling", path: "/test/sibling" }
const [worktrees, setWorktrees] = createSignal([worktree])
const [catalog, setCatalog] = createSignal({ id: "legacy", expanded: true })
const project = () => catalog().id
const setProject = (id: string) => setCatalog((prev) => ({ ...prev, id }))
let deletes = 0
let navigations = 0
const targets: AgentManagerSidebarTarget[] = []
const removed: string[] = []
const stores = new Map(["legacy", "project-two", "project-three"].map((id) => [id, createProjectStore(id)]))
for (const store of stores.values()) {
  store.setWorktrees([worktree, sibling])
  store.setManagedSessions([{ id: "ses-sibling", worktreeId: sibling.id }])
}
const [selection, setSelection] = createSignal(worktree.id)
const noop = () => {}
const Items = () => {
  const completion = createWorktreeCompletion(worktrees, project, () => "Test task")
  deletion = createWorktreeDelete({
    store: (id) => stores.get(id),
    project,
    selection,
    busy: (id, wt) => (busy() && wt === worktree.id) || stores.get(id)?.busy().has(wt) === true,
    blocked: () => false,
    select: (target) => targets.push(target),
    remove: (id, wt) => {
      removed.push(`${id}:${wt}`)
      deletes++
      setBusy(true)
    },
    reveal: noop,
  })
  return (
    <For each={catalog().expanded ? completion.rows() : []}>
      {(worktree) => (
        <WorktreeItem
          worktree={worktree}
          completed={completion.completed(worktree.id)}
          onCompletionEnd={() => completion.release(worktree.id)}
          label={worktree.label || "Test task"}
          active={false}
          pendingDelete={pending()}
          busy={busy()}
          activity="idle"
          stale={false}
          sessions={1}
          grouped={false}
          groupStart={false}
          groupEnd={false}
          groupSize={1}
          renaming={false}
          renameValue=""
          closeKeybind=""
          openKeybind=""
          onClick={() => {
            assert.equal(pending(), false, "card cancels before navigation")
            navigations++
          }}
          onDelete={() => deletion.confirm(project(), worktree.id)}
          onCancelDelete={deletion.cancel}
          onStartRename={noop}
          onRenameInput={noop}
          onCommitRename={noop}
          onCancelRename={noop}
          onRemoveStale={noop}
          onCopyPath={noop}
          onOpen={noop}
        />
      )}
    </For>
  )
}
const dispose = render(
  () => (
    <VSCodeProvider>
      <LanguageProvider>
        <Items />
      </LanguageProvider>
    </VSCodeProvider>
  ),
  root,
)
const button = (text: string) => {
  const el = [...root.querySelectorAll("button")].find(
    (el) => el.textContent?.trim() === text || el.getAttribute("aria-label") === text,
  )
  assert.ok(el, `Missing button: ${text}`)
  return el
}
const arm = async () => {
  button("Delete worktree").click()
  await Promise.resolve()
  assert.equal(pending(), true)
  assert.equal(deletes, 0)
  assert.ok(button("Delete?"))
}
// The keyboard ref and mouse callback use this same controller and rendered state.
setProject("project-two")
setCatalog((prev) => ({ ...prev, expanded: false }))
assert.equal(root.querySelector(".am-worktree-item"), null)
deletion.confirm(project(), worktree.id)
assert.equal(pending(), true)
// The host publishes a new catalog snapshot after the reveal request.
setCatalog((prev) => ({ ...prev, expanded: true }))
assert.equal(pending(), true, "revealing a collapsed project preserves its selected target's confirmation")
assert.ok(button("Delete?"), "the remounted worktree renders keyboard confirmation")
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
assert.equal(pending(), false, "Escape cancels confirmation after the row remounts")
setProject("legacy")
deletion.confirm(project(), worktree.id)
assert.ok(button("Delete?"), "keyboard close renders inline confirmation")
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
assert.equal(pending(), false)
deletion.confirm(project(), worktree.id)
assert.equal(deletes, 0, "Escape requires a fresh confirmation")
document.body.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }))
assert.equal(pending(), false, "outside click cancels keyboard confirmation")
deletion.confirm(project(), worktree.id)
setSelection(sibling.id)
assert.equal(pending(), false, "selection changes cancel confirmation")
setSelection(worktree.id)
deletion.confirm(project(), worktree.id)
setProject("project-two")
assert.equal(deletion.pending(), undefined, "project switches cancel even when worktree IDs collide")
deletion.confirm(project(), worktree.id)
assert.equal(deletes, 0)
setProject("legacy")
deletion.confirm("missing", worktree.id)
assert.equal(deletion.pending(), undefined, "unknown projects cannot arm deletion")
deletion.confirm(project(), "missing")
assert.equal(deletion.pending(), undefined, "unknown worktrees cannot arm deletion")
for (const state of ["running", "stopping"] as const) {
  stores.get("legacy")!.setRunStatuses({ [worktree.id]: { worktreeId: worktree.id, state } })
  deletion.confirm(project(), worktree.id)
  assert.equal(deletion.pending(), undefined, `${state} worktrees cannot arm deletion`)
}
stores.get("legacy")!.setRunStatuses({})
await arm()
root.querySelector<HTMLElement>(".am-worktree-branch")!.click()
assert.equal(navigations, 1)
assert.equal(deletes, 0)
await arm()
document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
assert.equal(pending(), false)
assert.equal(document.activeElement, button("Delete worktree"))
await arm()
document.body.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true }))
assert.equal(pending(), false)

await arm()
setBusy(true)
assert.equal(pending(), false, "cancel confirmation when the worktree becomes busy")
assert.equal(root.querySelector(".am-worktree-delete-hint"), null)
setBusy(false)
deletion.confirm(project(), worktree.id)
button("Delete?").click()
assert.equal(deletes, 1)
assert.deepEqual(removed, [`legacy:${worktree.id}`], "mouse confirms only the keyboard's project target")
assert.deepEqual(targets, [{ projectId: "legacy", kind: "worktree", worktreeId: sibling.id }])
assert.equal(stores.get("project-two")!.busy().size, 0, "deletion does not mark another project busy")
assert.equal(navigations, 1)
assert.ok(root.querySelector(".am-worktree-item"), "card remains until the host acknowledges deletion")
assert.ok(root.querySelector('.am-wt-icon[data-activity="busy"]'))
assert.equal(root.querySelector('button[aria-label="Delete worktree"]'), null)
assert.equal(root.querySelector(".am-worktree-completed"), null, "request is not success")
message({ type: "error", code: "agentManager.worktreeDeleteFailed", projectId: "legacy", worktreeId: worktree.id })
setBusy(false)
assert.equal(root.querySelector(".am-worktree-completed"), null, "failure is not success")
assert.ok(button("Delete worktree"))

for (const id of ["legacy", "project-two"]) {
  setProject(id)
  setWorktrees([worktree, sibling])
  message({ type: "agentManager.worktreeDeleted", projectId: "unrelated", worktreeId: worktree.id })
  assert.equal(root.querySelector(".am-worktree-completed"), null, "project IDs isolate completion")
  if (id === "project-two") setWorktrees([sibling])
  message({ type: "agentManager.worktreeDeleted", projectId: id, worktreeId: worktree.id })
  setWorktrees([sibling])
  const completed = root.querySelector(".am-worktree-completed")!
  assert.ok(completed, `${id}: retain success in either event order`)
  assert.equal(completed.querySelector(".am-worktree-branch")!.textContent, "Test task")
  assert.ok(completed.querySelector(".am-wt-name"), `${id}: strike the removed title`)
  assert.equal(completed.querySelector(".am-worktree-finish-box"), null, "no checkbox on a worktree card")
  assert.equal(completed.querySelector("[data-sidebar-id]"), null)
  assert.ok(completed.querySelector(".am-worktree-item")!.hasAttribute("inert"))
  assert.equal(completed.querySelector("[role=status]")!.textContent, "Test task: Deleted")
  assert.equal(root.querySelector('[data-sidebar-id="wt-sibling"]')!.closest(".am-worktree-completed"), null)
  completed.querySelector(".am-worktree-item")!.dispatchEvent(new window.Event("animationend", { bubbles: true }))
  assert.ok(root.querySelector(".am-worktree-completed"), "ignore child animation events")
  root.querySelector(".am-worktree-exit")!.dispatchEvent(new window.Event("animationend", { bubbles: true }))
  assert.equal(root.querySelector(".am-worktree-completed"), null, "release after collapse")
}
setWorktrees([worktree])
setWorktrees([])
assert.equal(root.querySelector(".am-worktree-item"), null, "unacknowledged removal has no completion feedback")
setProject("project-three")
message({ type: "agentManager.worktreeDeleted", projectId: project(), worktreeId: worktree.id })
assert.equal(root.querySelector(".am-worktree-item"), null, "do not retain rows from the previous project")
setWorktrees([worktree])
message({ type: "agentManager.worktreeDeleted", projectId: project(), worktreeId: worktree.id })
setWorktrees([])
await new Promise((resolve) => setTimeout(resolve, 1500))
assert.equal(root.querySelector(".am-worktree-item"), null, "fallback releases cards when animation events do not fire")
deletion.confirm("project-two", sibling.id)
deletion.confirm("project-two", sibling.id)
assert.deepEqual(removed, [`legacy:${worktree.id}`, `project-two:${sibling.id}`])
assert.equal(targets.length, 1, "deleting an inactive project's worktree does not change selection")
stores.get("project-three")!.setStaleWorktreeIds(new Set([sibling.id]))
deletion.select("project-three", worktree.id)
assert.deepEqual(targets.at(-1), { projectId: "project-three", kind: "local" }, "skip stale successors")
dispose()
await window.happyDOM.close()
console.log("Worktree Finish: confirmation, navigation, dismissal, activity, and guards passed")
