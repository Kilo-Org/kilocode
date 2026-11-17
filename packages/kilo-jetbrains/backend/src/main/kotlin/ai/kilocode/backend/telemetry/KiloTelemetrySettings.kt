package ai.kilocode.backend.telemetry

import ai.kilocode.backend.dev.KiloDevMode
import com.intellij.ide.util.PropertiesComponent

/**
 * The plugin's "Share usage analytics" setting (Settings → Tools → Kilo Code → Advanced), on by
 * default.
 *
 * The plugin only ever turns product telemetry **off**. With the setting on, the managed CLI keeps
 * its own resolution — an inherited `KILO_TELEMETRY_LEVEL`, then `experimental.openTelemetry` in the
 * global config — so an opt-out made at the CLI level is never overridden.
 */
object KiloTelemetrySettings {
    const val ENV = "KILO_TELEMETRY_LEVEL"
    private const val KEY = "kilo.telemetry.enabled"

    @Volatile
    private var fallback = true

    fun get(): Boolean {
        val props = props()
        return props?.getBoolean(KEY, true) ?: fallback
    }

    fun set(value: Boolean) {
        fallback = value
        val props = props()
        // The two-argument overload drops the key for a `false` value, which would read back as the
        // `true` default.
        props?.setValue(KEY, value.toString())
    }

    /**
     * The level to force on the spawned CLI, or null to leave [ENV] as inherited so the CLI resolves
     * telemetry itself.
     */
    fun level(dev: Boolean = KiloDevMode.enabled()): String? = if (dev || !get()) "off" else null

    /**
     * Whether the CLI's own resolution allows telemetry, mirroring `Telemetry.init` in
     * `packages/kilo-telemetry`: a non-empty inherited [ENV] decides, otherwise the global config
     * flag ([config], null when unset) does.
     */
    fun allowed(env: Map<String, String>, config: Boolean?): Boolean {
        val level = env[ENV]
        if (!level.isNullOrEmpty()) return level == "all"
        return config != false
    }

    private fun props(): PropertiesComponent? = runCatching { PropertiesComponent.getInstance() }.getOrNull()
}
