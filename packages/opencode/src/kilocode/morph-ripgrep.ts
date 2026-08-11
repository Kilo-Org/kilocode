import { target } from "@opencode-ai/core/kilocode/ripgrep-binary"
import { which } from "@opencode-ai/core/util/which"

export const rgPath = process.platform === "win32" ? target : (which("rg") ?? target)
