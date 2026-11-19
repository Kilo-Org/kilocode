import { expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { managementActions } from "../webview-ui/agent-manager/cloud/management-actions"
import { createCloudNavigation, type ChatRoute } from "../webview-ui/agent-manager/cloud/route"

test("closing a Cloud tab or dismissing the dialog never deletes; only confirmation sends the scoped idempotent mutation", async () => {
  const requests: { path: string; body: { target: ChatRoute["target"]; operationKey: string } }[] = []
  const api = OpenCode.make({
    baseUrl: "http://relay.invalid",
    fetch: Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = new Request(input, init),
          url = new URL(req.url)
        expect(url.searchParams.get("location[directory]")).toBe("/project")
        requests.push({ path: url.pathname, body: (await req.json()).input })
        if (requests.length === 1)
          return Response.json(
            { _tag: "RpcError", type: "HostedError", message: "root session cannot be deleted" },
            { status: 400 },
          )
        return Response.json({ output: { cleanup: "complete" } })
      },
      { preconnect: fetch.preconnect },
    ),
  })
  const route: ChatRoute = {
    kind: "session",
    projectID: "p",
    directory: "/project",
    repository: "fixture",
    scope: "account",
    target: { scope: "account", providerID: "kilo-cloud", workspaceID: "work", sessionID: "one" },
    title: "A",
  }
  const nav = createCloudNavigation()
  nav.select(route)
  managementActions(api, route).dismiss()
  nav.close(route)
  expect(nav.current()).toBeUndefined()
  expect(requests).toEqual([])
  const confirmed = managementActions(api, route)
  await expect(confirmed.confirmDelete()).rejects.toMatchObject({
    type: "HostedError",
    message: "root session cannot be deleted",
  })
  expect(await confirmed.confirmDelete()).toEqual({ cleanup: "complete" })
  expect(requests).toHaveLength(2)
  expect(requests[1]).toEqual(requests[0])
  expect(requests[0]).toMatchObject({ path: "/api/rpc/kilocode.hosted/deleteSession", body: { target: route.target } })
  expect(requests[0]?.body.operationKey).toMatch(/^[a-f0-9-]{36}$/)
  confirmed.dismiss()
})
