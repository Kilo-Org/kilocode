import type { PermissionOption } from "@agentclientprotocol/sdk"

// Skill-shell batches list their commands in the prompt and are never persisted, so the ACP
// prompt offers only Allow / Reject (no "Always allow") and a fixed title.
const options: PermissionOption[] = [
  { optionId: "once", kind: "allow_once", name: "Allow" },
  { optionId: "reject", kind: "reject_once", name: "Reject" },
]

export const SkillShellPrompt = {
  is(metadata: unknown) {
    return (metadata as { skillShell?: unknown })?.skillShell === true
  },
  options,
  title: "Run skill shell commands",
}
