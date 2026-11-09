import { expect, test } from "bun:test"
import { permissionPresentation } from "../../src/util/permission"

test("shows every requested permission when reviewing a Flow", () => {
  expect(
    permissionPresentation({
      action: "flow",
      resources: ["shell: git status *", "edit: /home/user/status.txt", "external_directory: /home/user/*"],
    }),
  ).toMatchObject({
    title: "Call tool flow",
    lines: ["- shell: git status *", "- edit: /home/user/status.txt", "- external_directory: /home/user/*"],
  })
})

test("preserves the upstream fallback for other custom permission actions", () => {
  expect(permissionPresentation({ action: "opencode_list_mcp_resources", resources: ["server-a"] })).toMatchObject({
    title: "Call tool opencode_list_mcp_resources",
    lines: ["Tool: opencode_list_mcp_resources"],
  })
})
