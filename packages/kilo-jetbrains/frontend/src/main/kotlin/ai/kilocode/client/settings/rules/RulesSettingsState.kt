package ai.kilocode.client.settings.rules

import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.ConfigPatchDto

internal data class RulesDraft(
    val instructions: List<String> = emptyList(),
    val compat: Boolean = false,
    /** Staged file-content edits, keyed by instruction path, written to disk on apply. */
    val edited: Map<String, String> = emptyMap(),
)

internal data class RulesChange(
    val config: ConfigPatchDto? = null,
    val compat: Boolean? = null,
    val edited: Map<String, String> = emptyMap(),
)

internal fun rulesDraft(config: ConfigDto?, compat: Boolean): RulesDraft = RulesDraft(
    instructions = config?.instructions ?: emptyList(),
    compat = compat,
)

internal fun configPatch(from: RulesDraft, to: RulesDraft): ConfigPatchDto? {
    if (from.instructions == to.instructions) return null
    return ConfigPatchDto(instructions = to.instructions)
}

internal fun rulesChange(from: RulesDraft, to: RulesDraft): RulesChange? {
    val config = configPatch(from, to)
    val compat = to.compat.takeIf { it != from.compat }
    val edited = to.edited
    if (config == null && compat == null && edited.isEmpty()) return null
    return RulesChange(config, compat, edited)
}

// Structural equality: the baseline always carries an empty [RulesDraft.edited], so any staged
// content edit makes the draft unequal (and therefore modified). This symmetric form is required by
// SettingsDraftState.complete, which also uses it to compare returned/target drafts.
internal fun savedMatches(base: RulesDraft, draft: RulesDraft): Boolean = base == draft
