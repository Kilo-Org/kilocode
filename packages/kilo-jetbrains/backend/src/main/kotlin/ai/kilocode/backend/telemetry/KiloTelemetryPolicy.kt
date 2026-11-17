package ai.kilocode.backend.telemetry

import ai.kilocode.backend.dev.KiloDevMode

/**
 * How product telemetry is resolved for the plugin's bundled CLI.
 *
 * The plugin keeps no telemetry state of its own. The CLI decides, exactly as it does standalone:
 * a non-empty inherited `KILO_TELEMETRY_LEVEL` wins, otherwise `experimental.openTelemetry` in the
 * global Kilo config does (see `Telemetry.init` in `packages/kilo-telemetry`). The "Share usage
 * analytics" toggle in the plugin settings edits that config key.
 */
object KiloTelemetryPolicy {
    const val ENV = "KILO_TELEMETRY_LEVEL"

    /** The level to force on the spawned CLI, or null to leave [ENV] as inherited. Only dev mode forces one. */
    fun level(dev: Boolean = KiloDevMode.enabled()): String? = if (dev) "off" else null

    /** The decision an inherited [ENV] makes, or null when it is unset and the global config decides. */
    fun override(env: Map<String, String>): Boolean? {
        val level = env[ENV]
        if (level.isNullOrEmpty()) return null
        return level == "all"
    }

    /** Whether telemetry is on, given the global config flag ([config], null when unset). */
    fun enabled(env: Map<String, String>, config: Boolean?): Boolean = override(env) ?: (config != false)
}
