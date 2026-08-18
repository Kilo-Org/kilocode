package ai.kilocode.backend.cli

import java.io.File

internal object KiloCliConfigPath {
    private const val APP = "kilo"

    fun resolve(env: Map<String, String>): File {
        env["KILO_CONFIG_DIR"]?.takeIf { it.isNotBlank() }?.let { return File(it) }
        env["XDG_CONFIG_HOME"]?.takeIf { it.isNotBlank() }?.let { return File(it, APP) }
        return File(File(home(env), ".config"), APP)
    }

    fun legacySettingsFile(env: Map<String, String>): File = File(resolve(env), "legacy-settings.json")

    private fun home(env: Map<String, String>): String {
        return env["HOME"]?.takeIf { it.isNotBlank() }
            ?: env["USERPROFILE"]?.takeIf { it.isNotBlank() }
            ?: System.getProperty("user.home")
    }
}
