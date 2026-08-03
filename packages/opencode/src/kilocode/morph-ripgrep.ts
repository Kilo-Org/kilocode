import path from "path"
import { Global } from "@opencode-ai/core/global"
import { which } from "@opencode-ai/core/util/which"

// Morph's local provider imports this path directly, but compiled Kilo binaries
// do not ship its optional @vscode/ripgrep platform package. Prefer a system
// binary and otherwise point it at the location managed by Kilo's ripgrep layer.
export const rgPath = which("rg") ?? path.join(Global.Path.bin, process.platform === "win32" ? "rg.exe" : "rg")
