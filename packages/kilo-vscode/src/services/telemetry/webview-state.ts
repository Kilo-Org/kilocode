type Post = (msg: { type: "telemetryState"; enabled: boolean }) => void

/** Push effective telemetry consent to a webview. */
export function pushTelemetryState(post: Post, enabled: boolean): void {
  post({ type: "telemetryState", enabled })
}
