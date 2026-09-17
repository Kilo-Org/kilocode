import assert from "node:assert/strict"
import { createSignal } from "solid-js"
import { harness } from "./comment-harness"

const { node, mount, wait } = await harness<{ type: string }>()
const { OrphanHelp } = await import("../../webview-ui/agent-manager/OrphanDialog")
const [expanded, setExpanded] = createSignal(false)
const release = mount(() => <OrphanHelp expanded={expanded()} onToggle={() => setExpanded((prev) => !prev)} />)
try {
  await wait()
  const list = () => document.querySelector(".am-orphan-help-list")
  const toggle = node<HTMLButtonElement>(".am-orphan-help-toggle")

  assert.equal(list(), null, "bullets are hidden while collapsed")
  assert.equal(toggle.textContent, "Show more")
  assert.equal(toggle.getAttribute("aria-expanded"), "false")

  toggle.click()
  await wait()

  assert.ok(list(), "bullets appear once expanded")
  assert.equal(list()?.children.length, 3)
  assert.equal(toggle.textContent, "Show less")
  assert.equal(toggle.getAttribute("aria-expanded"), "true")

  toggle.click()
  await wait()

  assert.equal(list(), null, "bullets collapse again on a second click")
  assert.equal(toggle.textContent, "Show more")
} finally {
  release()
}
