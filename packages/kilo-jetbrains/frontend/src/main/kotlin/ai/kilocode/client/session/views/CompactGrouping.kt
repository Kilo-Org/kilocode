package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolKind

/**
 * Groupable tool category. Every category maps to exactly one compact-mode toggle, and the mapping
 * is total: [OTHER] catches everything the named categories do not, so no tool can end up silently
 * ungroupable. Shell commands dominate real transcripts, so leaving them out made compact mode a
 * no-op on exactly the sessions that needed it most.
 */
enum class ToolGroupCategory { READ, WRITE, WEB, TASK, OTHER }

/** Whether a run of grouped tools reads as "N tools called" or "Running N subagents". */
enum class ToolGroupKind { MERGED, SUBAGENT }

private val WEB_TOOLS = setOf("websearch", "webfetch")

/** The category [tool] belongs to for compact-mode grouping. Never null — see [ToolGroupCategory]. */
fun categoryOf(tool: Tool): ToolGroupCategory = when {
    tool.name == "task" -> ToolGroupCategory.TASK
    tool.kind == ToolKind.READ -> ToolGroupCategory.READ
    tool.kind == ToolKind.WRITE -> ToolGroupCategory.WRITE
    tool.name in WEB_TOOLS -> ToolGroupCategory.WEB
    else -> ToolGroupCategory.OTHER
}

/**
 * The group [tool] should join, or null when it must render as a standalone card: compact mode is
 * off, or that category's grouping toggle is off. This is the single place [KiloPluginSettings]'s
 * compact-mode keys are read — every other call site derives grouping behavior from this function
 * instead of reading the settings directly.
 */
fun groupKindOf(tool: Tool): ToolGroupKind? {
    if (!KiloPluginSettings.getCompactMode()) return null
    return when (categoryOf(tool)) {
        ToolGroupCategory.TASK -> ToolGroupKind.SUBAGENT.takeIf { KiloPluginSettings.getCompactGroupSubagents() }
        ToolGroupCategory.READ -> ToolGroupKind.MERGED.takeIf { KiloPluginSettings.getCompactGroupReads() }
        ToolGroupCategory.WRITE -> ToolGroupKind.MERGED.takeIf { KiloPluginSettings.getCompactGroupWrites() }
        ToolGroupCategory.WEB -> ToolGroupKind.MERGED.takeIf { KiloPluginSettings.getCompactGroupWeb() }
        ToolGroupCategory.OTHER -> ToolGroupKind.MERGED.takeIf { KiloPluginSettings.getCompactGroupOther() }
    }
}
