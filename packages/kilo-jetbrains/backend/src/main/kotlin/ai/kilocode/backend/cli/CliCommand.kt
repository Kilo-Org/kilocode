package ai.kilocode.backend.cli

import java.nio.file.Path

internal data class CliCommand(
    val argv: List<String>,
    val env: Map<String, String> = emptyMap(),
    val expectedVersion: String? = null,
)

private val controlPrefixes = listOf("KILO_", "KILO2_", "KILOCODE_", "OPENCODE_")
private val devFixtureInputs = setOf(
    "KILO_V2_PROFILE", "OPENCODE_CONFIG_CONTENT", "KILO_DISABLE_MODELS_FETCH", "KILO_DISABLE_AUTOUPDATE",
    "KILO_API_URL", "KILO_AI_GATEWAY_URL", "KILO_API_KEY",
)

internal fun cliEnvironment(base: Map<String, String>, cwd: Path, editor: String, claudeCompat: Boolean, dev: Boolean = false) = buildMap {
    // An IDE started in another CLI's shell must not adopt its database, explicit config or approval policy.
    putAll(base.filterKeys { key ->
        val name = key.uppercase()
        name != "NODE_OPTIONS" && name != "BUN_OPTIONS" && controlPrefixes.none(name::startsWith)
    })
    if (dev) devFixtureInputs.forEach { key -> base[key]?.let { put(key, it) } }
    put("KILO_CLIENT", "jetbrains")
    put("KILO_PLATFORM", "jetbrains")
    put("KILO_TELEMETRY_LEVEL", "off")
    put("KILOCODE_EDITOR_NAME", editor)
    put("KILOCODE_FEATURE", "jetbrains-plugin")
    put("INIT_CWD", cwd.toString())
    putIfAbsent("NODE_USE_SYSTEM_CA", "1")
    if (!claudeCompat) put("KILO_DISABLE_CLAUDE_CODE", "true")
}
