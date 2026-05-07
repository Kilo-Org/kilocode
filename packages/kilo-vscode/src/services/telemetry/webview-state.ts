import * as vscode from "vscode"

type Post = (msg: { type: "telemetryState"; enabled: boolean }) => void

/**
 * Push the current VS Code telemetry-enabled flag to a webview. Called on
 * webview ready / re-sync so the webview can gate feedback UI on the flag.
 */
export function pushTelemetryState(post: Post): void {
  post({ type: "telemetryState", enabled: vscode.env.isTelemetryEnabled })
}

/**
 * Re-push telemetry state whenever the user toggles the VS Code telemetry
 * setting while a webview is open, so feedback UI shows/hides in real time.
 */
export function watchTelemetryState(post: Post): vscode.Disposable {
  return vscode.env.onDidChangeTelemetryEnabled((enabled) => {
    post({ type: "telemetryState", enabled })
  })
}
