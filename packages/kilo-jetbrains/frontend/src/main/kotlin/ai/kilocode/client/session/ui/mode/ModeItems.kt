package ai.kilocode.client.session.ui.mode

import ai.kilocode.rpc.dto.AgentDto

/**
 * Builds the mode picker item list from workspace [agents]. Shared by the session prompt and the
 * New Worktree dialog so agent display names (and the title-cased fallback) stay identical.
 */
internal fun modeItems(agents: List<AgentDto>?): List<ModePicker.Item> =
    agents.orEmpty().map {
        ModePicker.Item(it.name, agentTitle(it.name, it.displayName), it.description, it.deprecated == true)
    }

/**
 * The display name for an agent: its explicit [displayName], or a title-cased [name] fallback
 * (e.g. `upstream-merge` -> `Upstream Merge`) so built-in agent ids don't render lowercase.
 */
internal fun agentTitle(name: String, displayName: String?): String =
    displayName ?: name
        .split('-', '_')
        .filter { it.isNotEmpty() }
        .joinToString(" ") { it.replaceFirstChar { c -> c.titlecase() } }
        .ifEmpty { name }
