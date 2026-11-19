package ai.kilocode.backend.cli

import java.nio.file.Path

internal data class CliCommand(
    val argv: List<String>,
    val env: Map<String, String> = emptyMap(),
    val expectedVersion: String? = null,
)

private val inherited = setOf(
    "KILO_SERVER_PASSWORD", "OPENCODE_SERVER_PASSWORD", "OPENCODE_PASSWORD", "KILO_PARENT_PID",
    "KILO_USE_RELEASE_CONFIG", "KILO_CONFIG_DIR", "KILO_CONFIG", "KILO_DB", "KILO_CONFIG_CONTENT",
    "OPENCODE_CONFIG_DIR", "OPENCODE_CONFIG", "OPENCODE_DB", "OPENCODE_HOME_DIR", "OPENCODE_APP_DIR_NAME",
    "OPENCODE_SESSION_ID", "OPENCODE_PTY_HANDOFF", "OPENCODE_PRIVATE_TUI_LEASE", "OPENCODE_SSH_ASKPASS_PORT",
    "KILO_AGENT_MANAGER_HOST", "KILO_BROWSER_BROKER_URL", "KILO_BROWSER_BROKER_TOKEN",
    "KILO_NOTEBOOK_BROKER_URL", "KILO_NOTEBOOK_BROKER_TOKEN", "KILO_V2_TEST_BINARY",
    "KILO_DISABLE_CLAUDE_CODE", "OPENCODE_DISABLE_CLAUDE_CODE", "KILO_ENABLE_QUESTION_TOOL", "KILO_TELEMETRY_LEVEL",
    "KILO_TREE_SITTER_WASM_DIR", "KILO_BWRAP_PATH", "KILO_APP_NAME", "KILO_APP_VERSION", "KILO_EDITOR_NAME",
)

internal fun cliEnvironment(base: Map<String, String>, cwd: Path, editor: String, claudeCompat: Boolean) = buildMap {
    putAll(base.filterKeys { it.uppercase() !in inherited })
    put("KILO_CLIENT", "jetbrains")
    put("KILO_PLATFORM", "jetbrains")
    put("KILOCODE_EDITOR_NAME", editor)
    put("KILOCODE_FEATURE", "jetbrains-plugin")
    put("INIT_CWD", cwd.toString())
    putIfAbsent("NODE_USE_SYSTEM_CA", "1")
    putIfAbsent("OPENCODE_CONFIG_CONTENT", """{"permissions":[{"action":"edit","resource":"*","effect":"ask"}]}""")
    if (!claudeCompat) put("KILO_DISABLE_CLAUDE_CODE", "true")
}
