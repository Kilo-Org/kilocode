import { existsSync } from "node:fs"
import { defineConfig } from "@vscode/test-cli"

const installs = {
  darwin: [process.env.VSCODE_EXECUTABLE_PATH, "/Applications/Visual Studio Code.app/Contents/MacOS/Electron"],
  win32: [
    process.env.VSCODE_EXECUTABLE_PATH,
    "C:/Program Files/Microsoft VS Code/Code.exe",
    "C:/Program Files (x86)/Microsoft VS Code/Code.exe",
  ],
  linux: [process.env.VSCODE_EXECUTABLE_PATH, "/usr/share/code/code", "/snap/code/current/usr/share/code/code"],
}

const platform =
  process.platform === "darwin" || process.platform === "win32" || process.platform === "linux"
    ? process.platform
    : undefined
const executable = platform ? installs[platform].find((item) => item && existsSync(item)) : undefined

export default defineConfig({
  files: "out/test/**/*.test.js",
  download: { timeout: 120_000 },
  ...(executable ? { useInstallation: { fromPath: executable } } : {}),
})
