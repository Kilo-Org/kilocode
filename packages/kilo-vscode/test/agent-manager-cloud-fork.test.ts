import { expect, test } from "bun:test"
import { forkIntent } from "../webview-ui/agent-manager/cloud/fork-intent"
import { createCloudNavigation, type ChatRoute } from "../webview-ui/agent-manager/cloud/route"

test("a fork keeps its key on reopen and cannot steal navigation from another tab, account or Local", () => {
  const nav = createCloudNavigation()
  const origin: ChatRoute = {
    kind: "session",
    directory: "/project",
    projectID: "project",
    repository: "https://github.com/test/source",
    scope: "one",
    target: { providerID: "kilo-cloud", workspaceID: "origin", sessionID: "start", scope: "one" },
    title: "Source",
  }
  const destination = { ...origin.target, workspaceID: "fork", sessionID: "cloned" }
  nav.select(origin)
  const first = forkIntent(nav, origin)
  nav.leave()
  expect(first.select(destination)).toBe(false)
  nav.select({ ...origin, target: { ...origin.target, sessionID: "sibling" } })
  expect(first.select(destination)).toBe(false)
  nav.select(origin)
  expect(forkIntent(nav, origin).operationKey).toBe(first.operationKey)
  expect(first.select({ ...destination, scope: "other" })).toBe(false)
  expect(first.select(destination)).toBe(true)
  expect(nav.current()).toMatchObject({ target: destination, title: "Source" })
  nav.select(origin)
  expect(forkIntent(nav, origin).operationKey).not.toBe(first.operationKey)
})
