package ai.kilocode.backend.cli

import com.intellij.ide.util.PropertiesComponent

object KiloClaudeCompatSettings {
    private const val KEY = "kilo.claudeCodeCompat"
    private const val SKILLS_COMMANDS_KEY = "kilo.claudeCodeSkillsCommands"
    private const val INSTRUCTIONS_KEY = "kilo.claudeCodeInstructions"

    @Volatile
    private var fallback = Settings()

    data class Settings(val skillsCommands: Boolean = true, val instructions: Boolean = false)

    fun get(): Settings {
        val props = props()
        if (props == null) return fallback
        val migrated = props.getBoolean(KEY, false)
        return Settings(
            skillsCommands = props.getBoolean(SKILLS_COMMANDS_KEY, true),
            instructions = props.getBoolean(INSTRUCTIONS_KEY, migrated),
        )
    }

    fun set(value: Settings) {
        fallback = value
        val props = props()
        props?.setValue(SKILLS_COMMANDS_KEY, value.skillsCommands.toString())
        props?.setValue(INSTRUCTIONS_KEY, value.instructions.toString())
    }

    private fun props(): PropertiesComponent? = runCatching { PropertiesComponent.getInstance() }.getOrNull()
}
