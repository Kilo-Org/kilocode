import { describe, expect, it } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(import.meta.dir, "../..")
const list = fs.readFileSync(path.join(root, "webview-ui/src/components/chat/MessageList.tsx"), "utf8")
const indicator = fs.readFileSync(
  path.join(root, "webview-ui/src/components/chat/CloudMessageFailureIndicator.tsx"),
  "utf8",
)
const en = fs.readFileSync(path.join(root, "webview-ui/agent-manager/i18n/en.ts"), "utf8")
const stories = fs.readFileSync(path.join(root, "webview-ui/src/stories/chat.stories.tsx"), "utf8")

describe("Cloud Agent message failure indicator contract", () => {
  it("renders a localized alert at the transcript tail, including empty sessions", () => {
    expect(list).toContain("<CloudMessageFailureIndicator />")
    expect(list.indexOf("<CloudMessageFailureIndicator />")).toBeGreaterThan(list.indexOf("<TurnOutcome />"))
    expect(indicator).toContain("session.cloudMessageFailure()")
    expect(indicator).toContain('role="alert"')
    expect(indicator).toContain('variant="error"')
    expect(indicator).toContain("agentManager.cloud.message.failed")
    expect(indicator).toContain("agentManager.cloud.message.interrupted")
  })

  it("localizes and visually covers failed delivery", () => {
    expect(en).toContain('"agentManager.cloud.message.failed": "Message failed to deliver"')
    expect(en).toContain('"agentManager.cloud.message.interrupted": "Queued message interrupted"')
    expect(stories).toContain("CloudMessageFailureIndicatorFailed")
  })
})
