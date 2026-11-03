import assert from "node:assert/strict"
import type { JSX } from "solid-js"
import { harness } from "./comment-harness"

const { root, mount, wait } = await harness<{ type: string }>()
const { SidebarSectionHeader } = await import("../../webview-ui/agent-manager/SidebarSectionHeader")
const { WorktreeItem } = await import("../../webview-ui/agent-manager/WorktreeItem")

const noop = () => {}
const badge = () => <span class="am-splash-row-marker">1</span>
const worktree = {
  id: "wt",
  groupId: "group",
  branch: "feat/marker",
  path: "/tmp/wt",
  parentBranch: "main",
  createdAt: "2026-01-01T00:00:00.000Z",
}
const views = {
  header: (marker?: JSX.Element) => <SidebarSectionHeader label="Projects" count={3} marker={marker} />,
  worktree: (marker?: (id: string) => JSX.Element | undefined) => (
    <WorktreeItem
      worktree={worktree}
      label="Marker"
      active={false}
      pendingDelete={false}
      busy={false}
      activity="idle"
      stale={false}
      sessions={1}
      grouped
      groupStart
      groupEnd={false}
      groupSize={2}
      renaming={false}
      renameValue=""
      closeKeybind=""
      openKeybind=""
      marker={marker}
      onClick={noop}
      onDelete={noop}
      onStartRename={noop}
      onRenameInput={noop}
      onCommitRename={noop}
      onCancelRename={noop}
      onRemoveStale={noop}
      onCopyPath={noop}
      onOpen={noop}
    />
  ),
}
const html = async (view: () => JSX.Element) => {
  const release = mount(view)
  await wait()
  const result = root.innerHTML
  release()
  return result
}
// Generated ids count up across renders, so only the markup is compared.
const strip = (value: string) =>
  value.replaceAll('<span class="am-splash-row-marker">1</span>', "").replace(/cl-\d+/g, "cl")

const header = await html(() => views.header())
const marked = await html(() => views.header(badge()))
assert.ok(!header.includes("am-splash-row-marker"))
assert.equal((marked.match(/am-splash-row-marker/g) ?? []).length, 1)
assert.equal(strip(marked), strip(header), "a header marker adds only the badge")

const row = await html(() => views.worktree())
const rows = await html(() => views.worktree((id) => (id === "wt" || id === "group" ? badge() : undefined)))
assert.ok(!row.includes("am-splash-row-marker"))
assert.equal((rows.match(/am-splash-row-marker/g) ?? []).length, 2, "the row and its version group are badged")
assert.equal(strip(rows), strip(row), "worktree markers add only the badges")
