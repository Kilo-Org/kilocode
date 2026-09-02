import * as vscode from "vscode"

export function buildSleepSettingsMessage() {
  const config = vscode.workspace.getConfiguration("kilo-code.new")
  return {
    type: "sleepSettingsLoaded" as const,
    enabled: config.get<boolean>("preventSleepDuringTasks", false),
    timeout: config.get<number>("preventSleepDuringTasksTimeoutMinutes", 30),
  }
}
