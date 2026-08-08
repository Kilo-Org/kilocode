import path from "path"
import { Global } from "@opencode-ai/core/global"
import { which } from "@opencode-ai/core/util/which"

// Morph's local provider imports this path directly, but compiled Kilo binaries
// do not ship its optional @vscode/ripgrep platform package. Kilo's codebase
// search preflights its ripgrep layer, so the managed fallback exists before
// Morph's first spawn. Avoid Git-for-Windows' potentially incompatible MSYS rg.
const system = process.platform === "win32" ? null : which("rg")
export const rgPath = system ?? path.join(Global.Path.bin, process.platform === "win32" ? "rg.exe" : "rg")
