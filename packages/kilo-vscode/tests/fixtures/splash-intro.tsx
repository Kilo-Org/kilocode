import assert from "node:assert/strict"
import { harness } from "./comment-harness"

const { root, messages, mount, wait } = await harness<{ type: string }>()
const { createIntro } = await import("../../webview-ui/agent-manager/intro/AgentManagerIntro")
const release = mount(() => {
  const intro = createIntro({
    base: () => "main",
    git: () => true,
    onCreateWorktree: () => {},
    reveal: () => {},
    focus: () => {},
    compose: () => {},
  })
  intro.started()
  intro.started()
  return intro.render()
})
try {
  await wait()
  assert.ok(root.querySelector(".am-intro"), "the gate-off intro is the legacy intro")
  assert.equal(root.querySelector(".am-splash, .am-splash-folded"), null)
  assert.deepEqual(messages, [], "starting a session with the gate off persists nothing")
} finally {
  release()
}
