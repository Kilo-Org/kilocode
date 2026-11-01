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

// Control and bidirectional formatting characters: a hook's reason must not rewrite the prompt.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]+/g

// A PreToolUse hook that asks for confirmation is not a sandbox escalation: the prompt names the
// hook as the source and shows the reason it gave.
export const HookAskPrompt = {
  is(metadata: unknown) {
    return (metadata as { hookAsk?: unknown })?.hookAsk === true
  },
  title(metadata: unknown) {
    const reason = (metadata as { reason?: unknown })?.reason
    const text = typeof reason === "string" ? reason.replace(CONTROL, " ").trim() : ""
    return text ? `A hook asks for confirmation: ${text}` : "A hook asks for confirmation"
  },
}

export const SandboxPrompt = {
  is(metadata: unknown) {
    return (metadata as { sandboxEscalation?: unknown })?.sandboxEscalation === true
  },
  title: "Run outside the sandbox",
}
