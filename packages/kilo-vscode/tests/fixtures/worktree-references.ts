import assert from "node:assert/strict"
import { createRoot, createSignal } from "solid-js"
import { createProjectStore } from "../../webview-ui/agent-manager/project/store"
import { createWorktreeReferences } from "../../webview-ui/agent-manager/worktree-references"

await createRoot(async (dispose) => {
  const first = createProjectStore("first")
  const second = createProjectStore("second")
  const time = "2026-08-27T00:00:00.000Z"
  for (const project of [first, second]) {
    project.setWorktrees(
      ["one", "two"].map((id) => ({
        id,
        path: `/${project.id}/${id}`,
        branch: id,
        parentBranch: "main",
        createdAt: time,
      })),
    )
    project.setManagedSessions([{ id: "same", worktreeId: "one", createdAt: time }])
  }
  const [project, setProject] = createSignal(first)
  const [selection, select] = createSignal<string | null>(null)
  const storage = { value: {} as Record<string, unknown> }
  const sessions = () => [{ id: "same", title: project().id, updatedAt: time }]
  const refs = createWorktreeReferences(
    {
      getState: <T>() => storage.value as T,
      setState: (value) => {
        storage.value = value as Record<string, unknown>
      },
    },
    project,
    sessions,
    selection,
  )
  try {
    select("one")
    await Promise.resolve()
    assert.deepEqual(storage.value.worktreeMentionHistory, ["/first/one"])
    first.setStaleWorktreeIds(new Set(["two"]))
    select("two")
    await Promise.resolve()
    assert.deepEqual(storage.value.worktreeMentionHistory, ["/first/one"])
    assert.equal(refs().find((item) => item.id === "two")?.disabled, true)
    first.setStaleWorktreeIds(new Set())
    await Promise.resolve()
    assert.deepEqual(storage.value.worktreeMentionHistory, ["/first/two", "/first/one"])
    first.setBusy(new Map([["one", { reason: "creating" }]]))
    select("one")
    await Promise.resolve()
    assert.deepEqual(storage.value.worktreeMentionHistory, ["/first/two", "/first/one"])
    first.setBusy(new Map())
    await Promise.resolve()
    assert.deepEqual(
      refs().map((item) => item.path),
      ["/first/one", "/first/two"],
    )
    setProject(second)
    await Promise.resolve()
    assert.equal(refs()[0]?.sessions[0]?.title, "second")
    assert.equal(refs()[0]?.path, "/second/one")
    assert.equal((storage.value.worktreeMentionHistory as string[])[0], "/second/one")
  } finally {
    dispose()
  }
})
