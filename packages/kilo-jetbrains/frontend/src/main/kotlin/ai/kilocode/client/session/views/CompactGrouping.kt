package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolKind
import ai.kilocode.client.session.views.question.QuestionResultView
import ai.kilocode.client.session.views.todo.TodoWriteView

/**
 * Groupable tool category. Among tools that group at all the mapping is total: [OTHER] catches
 * everything the named categories do not, so no tool can end up silently ungroupable. Shell commands
 * dominate real transcripts, so leaving them out made compact mode a no-op on exactly the sessions
 * that needed it most.
 */
enum class ToolGroupCategory { READ, WRITE, WEB, TASK, OTHER }

/** Whether a run of grouped tools reads as "N tools called" or "Running N subagents". */
enum class ToolGroupKind { MERGED, SUBAGENT }

private val WEB_TOOLS = setOf("websearch", "webfetch")

/**
 * True when [tool] owns a dedicated content card: the to-do list, the "Plan is ready" card, or a
 * recorded question and answer. These carry meaningful output rather than tool noise, so folding them
 * into "N tools called" would hide precisely what compact mode exists to keep visible.
 *
 * Mirrors [ViewFactory]'s precedence, where these three win over the generic tool renderers. Note
 * these are state-dependent — an in-flight `plan_exit` is ordinary tool noise and groups normally,
 * then leaves the run once it completes and has a card to show.
 */
private fun dedicated(tool: Tool): Boolean =
    TodoWriteView.canRender(tool) || PlanExitView.canRender(tool) || QuestionResultView.canRender(tool)

/**
 * The category [tool] belongs to for compact-mode grouping, or null when it must never group because
 * it owns a dedicated content card. A null result also breaks the surrounding run.
 */
fun categoryOf(tool: Tool): ToolGroupCategory? = when {
    dedicated(tool) -> null
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
        null -> null
    }
}
