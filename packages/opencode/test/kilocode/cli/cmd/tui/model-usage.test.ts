import { describe, expect, test } from "bun:test"
import type { Session } from "@kilocode/sdk/v2"
import {
  failed,
  formatRate,
  isSessionTreeMember,
  label,
  select,
  type SessionModelUsage,
} from "@/kilocode/plugins/model-usage"

const session = (id: string, parentID?: string) =>
  ({
    id,
    parentID,
    slug: id,
    projectID: "project",
    directory: "/project",
    title: id,
    version: "1",
    time: { created: 0, updated: 0 },
  }) satisfies Session

const data = {
  totals: {
    steps: 0,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  },
  models: [],
} satisfies SessionModelUsage

describe("TUI model usage", () => {
  test("filters session results and formats usage labels", () => {
    const root = session("ses_root")
    const child = session("ses_child", root.id)
    const sessions = new Map([root, child].map((item) => [item.id, item]))

    expect(select({ sessionID: "ses_old", data }, "ses_current")).toBeUndefined()
    expect(failed({ sessionID: "ses_old" }, "ses_current")).toBeFalse()
    expect(select({ sessionID: "ses_current", data }, "ses_current")).toBe(data)
    expect(failed({ sessionID: "ses_current" }, "ses_current")).toBeTrue()
    expect(isSessionTreeMember({ root: root.id, sessionID: child.id, get: (id) => sessions.get(id) })).toBeTrue()
    expect(
      isSessionTreeMember({
        root: root.id,
        sessionID: "ses_new",
        info: session("ses_new", child.id),
        get: (id) => sessions.get(id),
      }),
    ).toBeTrue()
    expect(isSessionTreeMember({ root: root.id, sessionID: "ses_other", get: () => undefined })).toBeFalse()
    expect(
      label({
        providerID: "kilo",
        modelID: "openai/gpt-5.5-20260423",
        steps: 1,
        cost: 0,
        tokens: data.totals.tokens,
      }),
    ).toBe("gpt-5.5")
    expect(formatRate({ input: 100, output: 0, reasoning: 0, cache: { read: 300, write: 100 } })).toBe("60.0%")
  })
})
