import assert from "node:assert/strict"
import { createAnnotationHandler } from "../../src/kilo-provider/annotations"
import { createAnnotationBridge } from "../../webview-ui/src/utils/annotation-bridge"
import { newAnnotation } from "../../webview-ui/src/utils/annotations"
import type { AnnotationReply } from "../../src/shared/annotations"

const storage = process.argv[2]
if (!storage) throw new Error("Test storage is required")
const draft = newAnnotation({ sessionID: "ses_a", messageID: "msg_a", selectedText: "owned text", comment: "comment" })
const added = Promise.withResolvers<void>()
const removed = Promise.withResolvers<void>()
const pane = (observe = false) => {
  const listeners = new Set<(message: AnnotationReply | { type: string }) => void>()
  const handler = createAnnotationHandler({
    storage: () => storage,
    post: (message) => {
      if (observe && message.type === "annotationRecords") {
        if (message.items.some((item) => item.id === draft.id)) added.resolve()
        if (message.revision > 0 && message.items.length === 0) removed.resolve()
      }
      for (const listener of listeners) listener(message)
    },
  })
  const bridge = createAnnotationBridge({
    postMessage: handler.handle,
    onMessage: (callback) => {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
  })
  return {
    bridge,
    dispose: () => {
      bridge.dispose()
      handler.dispose()
    },
  }
}
const first = pane(true)
const second = pane()
const timeout = setTimeout(() => {
  console.error("Node annotation file-watch acknowledgement timed out")
  process.exit(1)
}, 10_000)

async function run() {
  await first.bridge.load("ses_a")
  assert.equal((await second.bridge.save(draft)).number, 1)
  await added.promise
  assert.equal((await first.bridge.load("ses_a"))[0]?.id, draft.id)
  await second.bridge.remove("ses_a", [draft.id])
  await removed.promise
  assert.deepEqual(await first.bridge.load("ses_a"), [])
  assert.equal((await first.bridge.save({ ...draft, id: crypto.randomUUID() })).number, 2)
}
void run()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    clearTimeout(timeout)
    first.dispose()
    second.dispose()
  })
