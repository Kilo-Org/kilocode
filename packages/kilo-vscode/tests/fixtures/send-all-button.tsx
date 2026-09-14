import assert from "node:assert/strict"
import { createSignal } from "solid-js"
import { harness } from "./comment-harness"
import type { PRCommentRequest } from "../../src/shared/pr-comment-actions"

const { window, root, button, wait, mount } = await harness<PRCommentRequest>()
const { SendAllButton } = await import("../../webview-ui/diff-viewer/SendAllButton")

const chat: string[] = []
const github: string[] = []
const [number, setNumber] = createSignal<number | undefined>(undefined)
const [pending, setPending] = createSignal(false)

const release = mount(() => (
  <SendAllButton
    count={2}
    githubCount={2}
    githubNumber={number()}
    pending={pending()}
    onSendChat={() => chat.push("chat")}
    onSendGithub={() => github.push("github")}
    keybind="Ctrl+Enter"
  />
))
await wait()

// Without a PR only the plain chat button is shown.
assert.equal(button("send-all-chat", root).textContent, "Send all to chat (2)")
assert.equal(root.querySelector('[data-action="send-all-github"]'), null)
button("send-all-chat", root).click()
assert.deepEqual(chat, ["chat"])
assert.deepEqual(github, [])

// With a PR both explicit actions appear, and the chat action keeps working.
setNumber(7)
await wait()
assert.equal(button("send-all-chat", root).textContent, "Send all to chat (2)")
assert.equal(button("send-all-github", root).textContent, "Send 2 to GitHub #7")
button("send-all-chat", root).click()
assert.deepEqual(chat, ["chat", "chat"])
assert.deepEqual(github, [])
button("send-all-github", root).click()
assert.deepEqual(github, ["github"])

// A pending send disables both actions.
setPending(true)
await wait()
assert.equal(button("send-all-chat", root).disabled, true)
assert.equal(button("send-all-github", root).disabled, true)
release()
await window.happyDOM.close()
