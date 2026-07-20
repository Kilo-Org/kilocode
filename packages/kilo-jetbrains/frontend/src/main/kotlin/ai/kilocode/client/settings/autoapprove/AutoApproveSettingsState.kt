package ai.kilocode.client.settings.autoapprove

import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.PermissionConfigDto
import ai.kilocode.rpc.dto.PermissionRuleDto

/**
 * Draft state for the Auto-Approve settings page: the desired `config.permission` map.
 *
 * Rule maps never hold explicit `null` values here — a tool/pattern is either present (with a
 * real level) or absent (inherited). `null` values only appear in the [PermissionConfigDto] patch
 * produced by [permissionPatch], where they signal deletion to the CLI's PATCH merge.
 */
internal data class PermissionDraft(val rules: Map<String, PermissionRuleDto> = emptyMap())

/** The three permission levels, in restrictiveness order. Shared by [LevelSelect] and [SettingsInlineList]. */
internal val LEVELS = listOf("allow", "ask", "deny")

// Keep aligned with the CLI's DEFAULT_RULES (permission-utils.ts:8-13).
private val DEFAULT_LEVEL = mapOf(
    "external_directory" to "ask",
    "bash" to "ask",
    "doom_loop" to "ask",
)

private val RESTRICTION_ORDER = mapOf("allow" to 0, "ask" to 1, "deny" to 2)

internal fun defaultLevel(tool: String): String = DEFAULT_LEVEL[tool] ?: "allow"

internal fun permissionDraft(config: ConfigDto?): PermissionDraft = PermissionDraft(config?.permission ?: emptyMap())

internal fun wildcardLevel(rule: PermissionRuleDto?): String? = when (rule) {
    null -> null
    is PermissionRuleDto.Level -> rule.value
    is PermissionRuleDto.Patterns -> rule.map["*"]
}

internal fun inheritedWildcard(rule: PermissionRuleDto?): Boolean = when (rule) {
    null -> true
    is PermissionRuleDto.Level -> false
    is PermissionRuleDto.Patterns -> rule.map["*"] == null
}

internal fun effectiveLevel(draft: PermissionDraft, tool: String): String =
    wildcardLevel(draft.rules[tool]) ?: defaultLevel(tool)

internal fun exceptions(rule: PermissionRuleDto?): List<Pair<String, String>> {
    if (rule !is PermissionRuleDto.Patterns) return emptyList()
    return rule.map.entries
        .filter { it.key != "*" && it.value != null }
        .map { it.key to it.value!! }
}

internal fun mostRestrictive(levels: List<String>): String {
    val start = levels.firstOrNull() ?: "allow"
    return levels.fold(start) { best, level ->
        if ((RESTRICTION_ORDER[level] ?: 0) > (RESTRICTION_ORDER[best] ?: 0)) level else best
    }
}

/** Set the wildcard level for [tool], preserving any existing exceptions. */
internal fun setWildcard(draft: PermissionDraft, tool: String, level: String): PermissionDraft {
    val excs = exceptions(draft.rules[tool])
    val rule = if (excs.isEmpty()) {
        PermissionRuleDto.Level(level)
    } else {
        PermissionRuleDto.Patterns(mapOf("*" to level) + excs.toMap())
    }
    return draft.copy(rules = draft.rules + (tool to rule))
}

/** Revert [tool]'s wildcard to the CLI default, preserving any existing exceptions. */
internal fun inheritWildcard(draft: PermissionDraft, tool: String): PermissionDraft {
    val excs = exceptions(draft.rules[tool])
    return if (excs.isNotEmpty()) {
        draft.copy(rules = draft.rules + (tool to PermissionRuleDto.Patterns(excs.toMap())))
    } else {
        draft.copy(rules = draft.rules - tool)
    }
}

/** Set (add or change) a single exception pattern's level for [tool]. */
internal fun setException(draft: PermissionDraft, tool: String, pattern: String, level: String): PermissionDraft {
    val rule = draft.rules[tool]
    val base = when (rule) {
        null -> emptyMap()
        is PermissionRuleDto.Level -> rule.value?.let { mapOf("*" to it) } ?: emptyMap()
        is PermissionRuleDto.Patterns -> rule.map.mapNotNull { (key, value) -> value?.let { key to it } }.toMap()
    }
    return draft.copy(rules = draft.rules + (tool to PermissionRuleDto.Patterns(base + (pattern to level))))
}

/** Add a new exception pattern for [tool], defaulting its level to allow. */
internal fun addException(draft: PermissionDraft, tool: String, pattern: String): PermissionDraft =
    setException(draft, tool, pattern, "allow")

/** Remove a single exception pattern for [tool]. */
internal fun removeException(draft: PermissionDraft, tool: String, pattern: String): PermissionDraft {
    val rule = draft.rules[tool] as? PermissionRuleDto.Patterns ?: return draft
    val map = rule.map.filterKeys { it != pattern }
    return if (map.isEmpty()) {
        draft.copy(rules = draft.rules - tool)
    } else {
        draft.copy(rules = draft.rules + (tool to PermissionRuleDto.Patterns(map)))
    }
}

internal fun removeExceptions(draft: PermissionDraft, tool: String, patterns: List<String>): PermissionDraft {
    if (patterns.isEmpty()) return draft
    val rule = draft.rules[tool] as? PermissionRuleDto.Patterns ?: return draft
    val remove = patterns.toSet()
    val map = rule.map.filterKeys { it !in remove }
    return if (map.isEmpty()) {
        draft.copy(rules = draft.rules - tool)
    } else {
        draft.copy(rules = draft.rules + (tool to PermissionRuleDto.Patterns(map)))
    }
}

/** Apply the same scalar level to every id in a grouped row (e.g. todoread/todowrite). */
internal fun setGrouped(draft: PermissionDraft, ids: List<String>, level: String): PermissionDraft =
    draft.copy(rules = draft.rules + ids.associateWith { PermissionRuleDto.Level(level) })

/** Revert every id in a grouped row to the CLI default. */
internal fun inheritGrouped(draft: PermissionDraft, ids: List<String>): PermissionDraft =
    draft.copy(rules = draft.rules - ids.toSet())

/**
 * Diff [from] (baseline) against [to] (draft) into a single [PermissionConfigDto] patch, or
 * `null` if there is nothing to send. See the plan's diff algorithm for the exact semantics:
 * missing-in-`to` tools are deleted (`Level(null)`), new tools are sent in full, and for tools
 * present in both, changed `Patterns` rules include `null` deletes for every pattern (including
 * `*`) that existed in `from` but is absent from `to`.
 */
internal fun permissionPatch(from: PermissionDraft, to: PermissionDraft): PermissionConfigDto? {
    val result = mutableMapOf<String, PermissionRuleDto>()
    for (tool in from.rules.keys + to.rules.keys) {
        val fromRule = from.rules[tool]
        val toRule = to.rules[tool]
        if (toRule == null) {
            if (fromRule != null) result[tool] = PermissionRuleDto.Level(null)
            continue
        }
        if (fromRule == null) {
            result[tool] = toRule
            continue
        }
        if (fromRule == toRule) continue
        result[tool] = when (toRule) {
            is PermissionRuleDto.Level -> toRule
            is PermissionRuleDto.Patterns -> {
                val map = toRule.map.toMutableMap()
                if (fromRule is PermissionRuleDto.Patterns) {
                    for (key in fromRule.map.keys) {
                        if (key !in toRule.map) map[key] = null
                    }
                }
                PermissionRuleDto.Patterns(map)
            }
        }
    }
    return result.takeIf { it.isNotEmpty() }
}

// Named `patch` (not `change`) to avoid colliding with BaseSettingsUi's `change()` override, which
// would otherwise resolve to itself and recurse infinitely instead of calling this top-level helper.
internal fun patch(from: PermissionDraft, to: PermissionDraft): ConfigPatchDto? =
    permissionPatch(from, to)?.let { ConfigPatchDto(permission = it) }

private fun normalize(rules: Map<String, PermissionRuleDto>): Map<String, PermissionRuleDto> =
    rules.mapNotNull { (tool, rule) ->
        when (rule) {
            is PermissionRuleDto.Level -> rule.value?.let { tool to rule }
            is PermissionRuleDto.Patterns -> {
                val map = rule.map.filterValues { it != null }
                if (map.isEmpty()) null else tool to PermissionRuleDto.Patterns(map)
            }
        }
    }.toMap()

internal fun savedMatches(base: PermissionDraft, draft: PermissionDraft): Boolean =
    normalize(base.rules) == normalize(draft.rules)

/** `external_directory` -> `External Directory`. */
internal fun toolTitle(id: String): String =
    id.split("_").joinToString(" ") { word -> word.replaceFirstChar { it.uppercaseChar() } }
