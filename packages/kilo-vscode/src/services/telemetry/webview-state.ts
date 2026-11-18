type Post = (msg: { type: "telemetryState"; enabled: boolean }) => void

/** Push the core's configured telemetry level to a webview. */
export function pushTelemetryState(post: Post, enabled: boolean): void {
  post({ type: "telemetryState", enabled })
}
