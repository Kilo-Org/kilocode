import { Spec } from "@opencode/cli/framework/spec"

export const RemoteCommand = Spec.make("remote", {
  description:
    "Host native sessions for remote control until interrupted. Requires Kilo sign-in and session sync. " +
    "New sessions and directory discovery stay within the launch directory. " +
    "Use /remote in the TUI, remote_control in kilo2.jsonc, or KILO_REMOTE=1 to enable control in an ordinary process.",
})
