import assert from "node:assert/strict"
import { Window } from "happy-dom"
import type { WorktreeState } from "../../webview-ui/src/types/messages"

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
const { post: message } = await import("../../webview-ui/src/utils/webview-message")
const root = document.createElement("div")
document.body.append(root)
const [pending, setPending] = createSignal(false)
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
const [project, setProject] = createSignal("legacy")
let deletes = 0
let navigations = 0
const noop = () => {}
const Items = () => {
  const completion = createWorktreeCompletion(worktrees, project, () => "Test task")
  return (
    <For each={completion.rows()}>
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
          onDelete={() => {
            if (pending()) {
              deletes++
              setPending(false)
              setBusy(true)
              return
            }
            setPending(true)
          }}
          onCancelDelete={() => setPending(false)}
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
await arm()
button("Delete?").click()
assert.equal(deletes, 1)
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
  assert.ok(completed.querySelector(".am-worktree-finish-box [data-component=icon]"))
  assert.equal(completed.querySelector("[data-sidebar-id]"), null)
  assert.ok(completed.querySelector(".am-worktree-item")!.hasAttribute("inert"))
  assert.equal(completed.querySelector("[role=status]")!.textContent, "Test task: Deleted")
  assert.equal(root.querySelector('[data-sidebar-id="wt-sibling"]')!.closest(".am-worktree-completed"), null)
  root.querySelector(".am-worktree-finish-box")!.dispatchEvent(new window.Event("animationend", { bubbles: true }))
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
dispose()
await window.happyDOM.close()
console.log("Worktree Finish: confirmation, navigation, dismissal, activity, and guards passed")
