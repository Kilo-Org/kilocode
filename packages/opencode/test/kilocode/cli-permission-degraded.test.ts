import { describe, expect, test } from "bun:test"
import { permissionInfo } from "../../src/cli/cmd/run/permission.shared"
import { ACTION_GATE_DEGRADED_KEY, ACTION_GATE_REASON_KEY } from "../../src/kilocode/permission/interactive-approval"

// The degraded CLI view must AUGMENT the normal edit view, not replace it: base.diff and base.file survive.
const editReq = (extraMeta: Record<string, unknown> = {}) =>
  ({
    id: "per_x",
    sessionID: "s",
    permission: "edit",
    patterns: ["/w/a.ts"],
    always: [],
    metadata: { filePath: "/w/a.ts", diff: "@@ -1 +1 @@\n-old\n+new", ...extraMeta },
  }) as unknown as Parameters<typeof permissionInfo>[0]

describe("CLI permissionInfo — degraded edit keeps diff + file (augment, not replace)", () => {
  test("degraded edit preserves base.diff and base.file, adds the classifier warning on top", () => {
    const base = permissionInfo(editReq())
    const deg = permissionInfo(editReq({ [ACTION_GATE_DEGRADED_KEY]: true, [ACTION_GATE_REASON_KEY]: "classifier_timeout" }))
    expect(base.diff).toBeDefined() // sanity: the normal edit view has a diff
    expect(base.file).toBe("/w/a.ts")
    expect(deg.diff).toBe(base.diff) // preserved through the degraded augment
    expect(deg.file).toBe(base.file) // preserved
    expect(deg.title).toContain("Safety classifier unavailable")
  })
})
