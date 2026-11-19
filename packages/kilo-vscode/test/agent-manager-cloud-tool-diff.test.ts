import { expect, test } from "bun:test"
import { createCloudToolPreview, type DiffPreferences } from "../webview-ui/agent-manager/cloud/tool-diff"
import type { ChatRoute } from "../webview-ui/agent-manager/cloud/route"

test("Cloud preview renders captured files together, follows shared preferences, and fences stale card actions", () => {
  const route: ChatRoute = {
    kind: "session",
    projectID: "fixture",
    directory: "/checkout",
    scope: "scope",
    repository: "repo",
    title: "chat",
    target: { providerID: "kilo-cloud", workspaceID: "workspace", sessionID: "session", scope: "scope" },
  }
  let active = true,
    opens = 0,
    style: "unified" | "split" = "unified",
    markdown = false
  const prefs: DiffPreferences = {
    style: () => style,
    markdown: () => markdown,
    updateStyle: (v) => {
      style = v
    },
    updateMarkdown: (v) => {
      markdown = v
    },
  }
  const panel = createCloudToolPreview(
    (r) => r === route && active,
    prefs,
    () => {
      opens++
    },
    () => {},
  )
  const actions = panel.actions(route)
  const file = { file: "/remote/README.md", additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+Remote only\n" }
  const other = { ...file, file: "lib.ts" }
  expect(Object.keys(actions).sort()).toEqual(["openDiff", "openDiffs"])
  actions.openDiffs?.([file, { ...other, patch: "" }])
  expect(opens).toBe(0)
  actions.openDiffs?.([file, other])
  expect(panel.preview()?.diff.files).toEqual([file, other])
  expect(opens).toBe(1)
  panel.updateStyle("split")
  panel.updateMarkdown(true)
  expect(panel.preview()).toMatchObject({ style: "split", markdown: true })
  active = false
  expect(panel.preview()).toBeUndefined()
  actions.openDiff?.(file)
  expect(opens).toBe(1)
  panel.clear()
  active = true
  expect(panel.preview()).toBeUndefined()
  actions.openDiff?.(other)
  expect(panel.preview()?.diff).toEqual(other)
})
