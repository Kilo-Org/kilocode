import { describe, expect, test } from "bun:test"
import type { PermissionRequest, PermissionSavedInfo, SessionInfo } from "@opencode/client"
import { allowBroader, displayResource, widenSaved, widerRule } from "../webview-ui/src/v2/permission-rules"

const ORIGIN = "navigate:http://localhost:3000"

const request = (input: Partial<PermissionRequest> = {}): PermissionRequest => ({
  id: "per_browser",
  sessionID: "ses_browser",
  action: "browser_open",
  resources: [ORIGIN],
  save: [ORIGIN],
  metadata: { rules: [ORIGIN, "navigate:*"] },
  ...input,
})

type Row = Pick<PermissionSavedInfo, "projectID" | "action" | "resource">

/**
 * An in-memory saved-permission table that behaves like `PermissionSaved`: an update keeps the fields it omits, and
 * (project, action, resource) is unique. `calls` records every request in order.
 */
function server(rows: Row[] = []) {
  const calls: unknown[][] = []
  const saved: PermissionSavedInfo[] = []
  const insert = (row: Row) =>
    saved.push({ id: `psv_${saved.length}`, ...row, time: { created: 0, updated: 0 } } as PermissionSavedInfo)
  rows.forEach(insert)
  return {
    calls,
    rows: () => saved.map((row) => `${row.projectID} ${row.action} ${row.resource}`),
    // Like the server, "always" saves the request's `save` rules for the session's project.
    reply(projectID: string) {
      return async (input: { sessionID: string; requestID: string; decision: "always" }) => {
        calls.push(["reply", input])
        insert({ projectID, action: "browser_open", resource: ORIGIN })
      }
    },
    session: {
      async get(input: { sessionID: string }) {
        calls.push(["session.get", input])
        return { projectID: "prj_a" } as SessionInfo
      },
    },
    saved: {
      async list(input?: { projectID?: string }) {
        calls.push(["list", input])
        return saved.filter((row) => !input?.projectID || row.projectID === input.projectID)
      },
      async update(input: { id: string; action?: string; resource?: string }) {
        calls.push(["update", input])
        const row = saved.find((item) => item.id === input.id)!
        const next = { action: input.action ?? row.action, resource: input.resource ?? row.resource }
        if (
          saved.some(
            (item) =>
              item !== row &&
              item.projectID === row.projectID &&
              item.action === next.action &&
              item.resource === next.resource,
          )
        )
          throw new Error("conflict")
        Object.assign(row, next)
        return row
      },
    },
  }
}

describe("browser_open permission display", () => {
  test("hides the navigate: prefix", () => {
    expect(displayResource("browser_open", ORIGIN)).toBe("http://localhost:3000")
    expect(displayResource("browser_open", "navigate:*")).toBe("*")
  })

  test("keeps other resources as they are", () => {
    expect(displayResource("shell", "navigate:foo")).toBe("navigate:foo")
    expect(displayResource("browser_open", "*")).toBe("*")
  })
})

describe("browser_open broader rule", () => {
  test("offers the rule metadata lists beyond the saved origin", () => {
    expect(widerRule(request())).toBe("navigate:*")
  })

  test("offers nothing without metadata rules, for another tool, or without exactly one saved origin", () => {
    expect(widerRule(request({ metadata: undefined }))).toBeUndefined()
    expect(widerRule(request({ action: "webfetch" }))).toBeUndefined()
    expect(widerRule(request({ metadata: { rules: [ORIGIN] } }))).toBeUndefined()
    expect(widerRule(request({ save: undefined }))).toBeUndefined()
    expect(widerRule(request({ save: [ORIGIN, "navigate:https://kilo.ai"] }))).toBeUndefined()
  })
})

describe("widening a saved origin approval", () => {
  const input = { projectID: "prj_a", action: "browser_open", from: ORIGIN, to: "navigate:*" }

  test("rewrites only the resource of the saved origin rule", async () => {
    const api = server([{ projectID: "prj_a", action: "browser_open", resource: ORIGIN }])
    await widenSaved(api.saved, input)
    expect(api.calls.at(-1)).toEqual(["update", { id: "psv_0", resource: "navigate:*" }])
    expect(api.rows()).toEqual(["prj_a browser_open navigate:*"])
  })

  test("leaves the project alone when it already allows every site", async () => {
    const api = server([
      { projectID: "prj_a", action: "browser_open", resource: "navigate:*" },
      { projectID: "prj_a", action: "browser_open", resource: ORIGIN },
    ])
    await widenSaved(api.saved, input)
    expect(api.rows()).toEqual(["prj_a browser_open navigate:*", `prj_a browser_open ${ORIGIN}`])
  })

  test("does not touch another project's approval", async () => {
    const api = server([{ projectID: "prj_b", action: "browser_open", resource: ORIGIN }])
    await widenSaved(api.saved, input)
    expect(api.rows()).toEqual([`prj_b browser_open ${ORIGIN}`])
  })
})

describe("Allow all sites", () => {
  test("replies always before it widens the rule the reply saved", async () => {
    const api = server()
    await allowBroader(
      { reply: api.reply("prj_a"), project: () => "prj_a", session: api.session, saved: api.saved },
      request(),
      "navigate:*",
    )
    expect(api.calls).toEqual([
      ["reply", { sessionID: "ses_browser", requestID: "per_browser", decision: "always" }],
      ["list", { projectID: "prj_a" }],
      ["update", { id: "psv_0", resource: "navigate:*" }],
    ])
    expect(api.rows()).toEqual(["prj_a browser_open navigate:*"])
  })

  test("reads the project from the server when the session is not loaded", async () => {
    const api = server()
    await allowBroader(
      { reply: api.reply("prj_a"), project: () => undefined, session: api.session, saved: api.saved },
      request(),
      "navigate:*",
    )
    expect(api.calls[1]).toEqual(["session.get", { sessionID: "ses_browser" }])
    expect(api.rows()).toEqual(["prj_a browser_open navigate:*"])
  })

  test("saves nothing broader when the reply fails", async () => {
    const api = server()
    const reply = async () => {
      throw new Error("offline")
    }
    const answer = allowBroader(
      { reply, project: () => "prj_a", session: api.session, saved: api.saved },
      request(),
      "navigate:*",
    )
    await expect(answer).rejects.toThrow("offline")
    expect(api.calls).toEqual([])
  })
})
