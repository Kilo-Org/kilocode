import type { FileDiffInfo } from "@opencode/client"
import type { ToolApproval } from "../src/components/tool-approval"

export const editedFile: FileDiffInfo = {
  file: "src/math.ts",
  patch:
    "--- a/src/math.ts\n+++ b/src/math.ts\n@@ -1,1 +1,2 @@\n export const VERSION = \"1.2.3\"\n+export const NAME = \"fixture\"\n",
  additions: 1,
  deletions: 0,
  status: "modified",
}

export const writtenFile: FileDiffInfo = {
  file: "src/notes.md",
  patch:
    "--- a/src/notes.md\n+++ b/src/notes.md\n@@ -0,0 +1,2 @@\n+# Notes\n+Fixture content.\n",
  additions: 2,
  deletions: 0,
  status: "added",
}

export const unchangedFile: FileDiffInfo = {
  file: "src/notes.md",
  patch: "",
  additions: 0,
  deletions: 0,
  status: "modified",
}

export const patchedFiles: FileDiffInfo[] = [
  {
    file: "src/math.ts",
    patch: "--- a/src/math.ts\n+++ b/src/math.ts\n@@ -1,1 +1,2 @@\n export const VERSION = \"1.2.3\"\n+export const NAME = \"fixture\"\n",
    additions: 1,
    deletions: 0,
    status: "modified",
  },
  {
    file: "src/legacy.ts",
    patch: "--- a/src/legacy.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-export const LEGACY = true\n",
    additions: 0,
    deletions: 1,
    status: "deleted",
  },
]

export const agentApproval: ToolApproval = {
  source: "agent",
  agent: "build",
  rule: { permission: "edit", pattern: "src/**", action: "allow" },
  outsideWorkspace: true,
  outsideWorkspacePath: "/tmp/other/src/math.ts",
}

export const manualApproval: ToolApproval = { source: "manual" }
