import { cmd } from "@/cli/cmd/cmd"

export const PtySmokeCommand = cmd({
  command: "__pty-smoke",
  describe: false,
  async handler() {
    if (process.env.KILO_PTY_SMOKE !== "1") throw new Error("PTY smoke command is release-only")
    const { PtySmoke } = await import("@opencode-ai/core/kilocode/pty/smoke")
    await PtySmoke.smoke()
  },
})
