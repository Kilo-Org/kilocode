import * as vscode from "vscode"

/**
 * Centralized logging service for KiloCode V4 subsystems.
 *
 * Features:
 * - VS Code OutputChannel ("KiloCode V4") for structured logs visible in Output panel
 * - Debug mode toggle via `kilo-code.v4.debugMode` configuration key
 * - Per-service tag prefixes for easy filtering
 * - Structured JSON logs in debug mode for external tool consumption
 * - Message contract tracing (webview↔extension message logging)
 * - Performance timing helpers
 *
 * Usage:
 *   const log = KiloLogger.for("RoutingService")
 *   log.info("Provider health check passed", { provider: "ollama" })
 *   log.debug("Route trace", { trace })  // only in debug mode
 *   log.error("API key validation failed", error)
 *   const end = log.time("healthCheck"); ... end()
 */

export type LogLevel = "debug" | "info" | "warn" | "error"

interface LogEntry {
  timestamp: string
  level: LogLevel
  service: string
  message: string
  data?: unknown
}

export class KiloLogger implements vscode.Disposable {
  private static instance: KiloLogger | undefined
  private static outputChannel: vscode.OutputChannel | undefined
  private static debugMode = false
  private static configListener: vscode.Disposable | undefined
  private static messageTracing = false

  private readonly service: string

  private constructor(service: string) {
    this.service = service
  }

  /**
   * Initialize the logging system. Call once during extension activation.
   * Creates the OutputChannel and starts listening for debug mode changes.
   */
  static initialize(): void {
    if (!KiloLogger.outputChannel) {
      KiloLogger.outputChannel = vscode.window.createOutputChannel("KiloCode V4")
    }

    // Read initial debug mode setting
    const config = vscode.workspace.getConfiguration("kilo-code.v4")
    KiloLogger.debugMode = config.get<boolean>("debugMode", false)
    KiloLogger.messageTracing = config.get<boolean>("messageTracing", false)

    // Listen for configuration changes
    KiloLogger.configListener?.dispose()
    KiloLogger.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("kilo-code.v4.debugMode")) {
        const prev = KiloLogger.debugMode
        KiloLogger.debugMode = vscode.workspace.getConfiguration("kilo-code.v4").get<boolean>("debugMode", false)
        if (prev !== KiloLogger.debugMode) {
          KiloLogger.outputChannel?.appendLine(
            `[${new Date().toISOString()}] [SYSTEM] Debug mode ${KiloLogger.debugMode ? "ENABLED" : "DISABLED"}`,
          )
          if (KiloLogger.debugMode) {
            KiloLogger.outputChannel?.show(true) // Reveal the output channel when debug is enabled
          }
        }
      }
      if (e.affectsConfiguration("kilo-code.v4.messageTracing")) {
        KiloLogger.messageTracing = vscode.workspace
          .getConfiguration("kilo-code.v4")
          .get<boolean>("messageTracing", false)
      }
    })
  }

  /**
   * Create a logger instance scoped to a specific service.
   * Lightweight — safe to call in constructors.
   */
  static for(service: string): KiloLogger {
    return new KiloLogger(service)
  }

  /** Whether debug mode is currently active */
  static get isDebugMode(): boolean {
    return KiloLogger.debugMode
  }

  /** Whether message tracing is currently active */
  static get isMessageTracing(): boolean {
    return KiloLogger.messageTracing
  }

  /** Programmatically toggle debug mode (also persists to settings) */
  static async setDebugMode(enabled: boolean): Promise<void> {
    KiloLogger.debugMode = enabled
    await vscode.workspace.getConfiguration("kilo-code.v4").update("debugMode", enabled, vscode.ConfigurationTarget.Global)
  }

  /** Show the KiloCode V4 output channel */
  static showChannel(): void {
    KiloLogger.outputChannel?.show(true)
  }

  // ─── Instance methods ─────────────────────────────────

  /** Always logged. For operational events. */
  info(message: string, data?: unknown): void {
    this.write("info", message, data)
  }

  /** Always logged. For warnings that don't interrupt operation. */
  warn(message: string, data?: unknown): void {
    this.write("warn", message, data)
  }

  /** Always logged. For errors. */
  error(message: string, data?: unknown): void {
    this.write("error", message, data)
  }

  /** Only logged in debug mode. For verbose/trace data. */
  debug(message: string, data?: unknown): void {
    if (!KiloLogger.debugMode) return
    this.write("debug", message, data)
  }

  /**
   * Log a webview↔extension message (only in message tracing mode).
   * Direction: "in" = webview→extension, "out" = extension→webview
   */
  trace(direction: "in" | "out", messageType: string, data?: unknown): void {
    if (!KiloLogger.messageTracing) return
    const arrow = direction === "in" ? "→" : "←"
    const label = direction === "in" ? "WEBVIEW→EXT" : "EXT→WEBVIEW"
    this.write("debug", `${label} ${arrow} ${messageType}`, data)
  }

  /**
   * Start a performance timer. Returns a function that, when called,
   * logs the elapsed time.
   *
   *   const end = log.time("healthCheck")
   *   await doWork()
   *   end()  // logs: "[RoutingService] healthCheck completed in 142ms"
   */
  time(label: string): () => void {
    const start = performance.now()
    this.debug(`${label} started`)
    return () => {
      const elapsed = Math.round(performance.now() - start)
      this.info(`${label} completed in ${elapsed}ms`)
    }
  }

  // ─── Internal ─────────────────────────────────────────

  private write(level: LogLevel, message: string, data?: unknown): void {
    const timestamp = new Date().toISOString()
    const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.service}]`
    const line = data !== undefined ? `${prefix} ${message} ${this.formatData(data)}` : `${prefix} ${message}`

    // Write to OutputChannel
    KiloLogger.outputChannel?.appendLine(line)

    // Also write to console for DevTools visibility
    switch (level) {
      case "error":
        console.error(`[Kilo V4] [${this.service}]`, message, data ?? "")
        break
      case "warn":
        console.warn(`[Kilo V4] [${this.service}]`, message, data ?? "")
        break
      case "debug":
        console.log(`[Kilo V4] [${this.service}]`, message, data ?? "")
        break
      default:
        console.log(`[Kilo V4] [${this.service}]`, message, data ?? "")
    }
  }

  private formatData(data: unknown): string {
    if (data instanceof Error) {
      return `Error: ${data.message}${data.stack ? `\n${data.stack}` : ""}`
    }
    try {
      return JSON.stringify(data, null, KiloLogger.debugMode ? 2 : 0)
    } catch {
      return String(data)
    }
  }

  // ─── Dispose ──────────────────────────────────────────

  dispose(): void {
    // Instance dispose is a no-op; static cleanup is below
  }

  /** Call during extension deactivation to clean up static resources */
  static shutdown(): void {
    KiloLogger.configListener?.dispose()
    KiloLogger.configListener = undefined
    KiloLogger.outputChannel?.dispose()
    KiloLogger.outputChannel = undefined
    KiloLogger.instance = undefined
  }
}
