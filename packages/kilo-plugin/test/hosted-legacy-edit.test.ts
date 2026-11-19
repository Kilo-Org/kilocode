import { expect, test } from "bun:test"
import { legacyPage } from "../src/hosted/live-legacy"

function tool(name: string, input: object, metadata: object) {
  const message = legacyPage(
    [
      {
        info: { id: "msg_one", sessionID: "ses_fixture", role: "assistant", time: { created: 1 } },
        parts: [
          {
            id: "part_one",
            sessionID: "ses_fixture",
            messageID: "msg_one",
            type: "tool",
            tool: name,
            state: { status: "completed", input, metadata },
          },
        ],
      },
    ],
    "ses_fixture",
  )[0]!.message
  if (message.type !== "assistant") throw Error("Unexpected message")
  return message.content[0]
}

test("legacy patch, edit and write tools project saved diffs into native tool-card inputs", () => {
  const f = { file: "/sandbox/one", patch: "@@ -0,0 +1 @@\n+content\n", additions: 1, deletions: 0 }
  const files = [
    { ...f, relativePath: "one", type: "add" },
    { ...f, relativePath: "two", type: "update" },
  ]
  expect(tool("apply_patch", { patchText: "captured" }, { files })).toMatchObject({
    name: "patch",
    state: {
      metadata: {
        files: [
          { file: "one", status: "added", patch: f.patch },
          { file: "two", status: "modified", patch: f.patch },
        ],
      },
    },
  })
  for (const name of ["write", "edit"])
    expect(tool(name, { filePath: f.file }, { filediff: f })).toMatchObject({
      name,
      state: { input: { path: f.file }, metadata: { files: [{ ...f, status: "modified" }] } },
    })
  expect(tool("write", { filePath: f.file }, { filediff: { ...f, patch: "" } })).toMatchObject({
    state: { metadata: { files: [{ patch: "" }] } },
  })
})
