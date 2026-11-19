package ai.kilocode.backend.cli

import com.intellij.ide.util.PropertiesComponent

object KiloClaudeCompatSettings {
    private const val KEY = "kilo2.claudeCodeCompat"
    fun get(): Boolean = PropertiesComponent.getInstance().getBoolean(KEY, false)
    fun set(value: Boolean) = PropertiesComponent.getInstance().setValue(KEY, value, false)
}
