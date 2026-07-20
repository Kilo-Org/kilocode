package ai.kilocode.client.settings.autoapprove

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.BaseContentPanel
import com.intellij.util.concurrency.annotations.RequiresEdt

private enum class ExceptionKind { PATH, COMMAND }

private val GRANULAR_TOOLS = listOf(
    "external_directory" to ExceptionKind.PATH,
    "bash" to ExceptionKind.COMMAND,
    "read" to ExceptionKind.PATH,
    "edit" to ExceptionKind.PATH,
)

private val SIMPLE_TOOLS = listOf("glob", "grep", "list", "task", "skill", "lsp")
private val GROUPED_IDS = listOf("todoread", "todowrite")
private val TRAILING_TOOLS = listOf("websearch", "webfetch", "doom_loop")

/**
 * Full Auto-Approve page layout: four granular tool sections, then a section covering the
 * remaining simple/grouped/trailing tools, in the exact order used by VS Code's
 * `PermissionEditor.tsx`.
 */
internal class AutoApproveContent(
    private val update: (PermissionDraft.() -> PermissionDraft) -> Unit,
    private val picker: LevelPicker = PopupLevelPicker,
) : BaseContentPanel() {
    private val granular = GRANULAR_TOOLS.map { (id, kind) -> id to granularSection(id, kind) }
    private val tools = SettingsInlineList(
        empty = KiloBundle.message("settings.autoApprove.tools.empty"),
        onSetLevel = { key, level -> update { setListTool(this, key, level) } },
        onInherit = { key -> update { inheritListTool(this, key) } },
        picker = picker,
    )

    init {
        granular.forEach { (_, section) -> next(section) }
        section(KiloBundle.message("settings.autoApprove.title")).row(tools)
    }

    @RequiresEdt
    fun sync(draft: PermissionDraft, enabled: Boolean) {
        for ((id, section) in granular) section.sync(draft.rules[id], enabled)
        tools.syncRows(toolRows(draft), enabled)
    }

    /** Filter every list on the page by [query], driven by the shared search field. */
    @RequiresEdt
    fun filter(query: String) {
        for ((_, section) in granular) section.filter(query)
        tools.filter(query)
    }

    private fun granularSection(tool: String, kind: ExceptionKind): GranularToolSection {
        val commands = kind == ExceptionKind.COMMAND
        val wildcardKey = if (commands) "commands" else "paths"
        val emptyKey = if (commands) "commands" else "paths"
        val addKey = if (commands) "addCommand" else "addPath"
        val placeholderKey = if (commands) "placeholder.command" else "placeholder.path"
        return GranularToolSection(
            tool,
            KiloBundle.message("settings.autoApprove.tool.$tool"),
            KiloBundle.message("settings.autoApprove.wildcardLabel.$wildcardKey"),
            KiloBundle.message("settings.autoApprove.filters.empty.$emptyKey"),
            KiloBundle.message("settings.autoApprove.$addKey"),
            KiloBundle.message("settings.autoApprove.$placeholderKey"),
            picker,
            { level -> update { setWildcard(this, tool, level) } },
            { update { inheritWildcard(this, tool) } },
            { pattern -> update { addException(this, tool, pattern) } },
            { pattern, level -> update { setException(this, tool, pattern, level) } },
            { patterns -> update { removeExceptions(this, tool, patterns) } },
        )
    }

    private fun toolRows(draft: PermissionDraft): List<PermissionListRow> = buildList {
        for (id in SIMPLE_TOOLS) add(toolRow(draft, id))
        add(groupedRow(draft))
        for (id in TRAILING_TOOLS) add(toolRow(draft, id))
    }

    private fun toolRow(draft: PermissionDraft, tool: String) = PermissionListRow(
        key = tool,
        title = toolTitle(tool),
        description = KiloBundle.message("settings.autoApprove.tool.$tool"),
        level = effectiveLevel(draft, tool),
        inherited = inheritedWildcard(draft.rules[tool]),
        defaultLevel = defaultLevel(tool),
        canInherit = true,
    )

    private fun groupedRow(draft: PermissionDraft) = PermissionListRow(
        key = GROUP_KEY,
        title = "Todoread / Todowrite",
        description = KiloBundle.message("settings.autoApprove.tool.todoreadwrite"),
        level = mostRestrictive(GROUPED_IDS.map { effectiveLevel(draft, it) }),
        inherited = GROUPED_IDS.all { inheritedWildcard(draft.rules[it]) },
        defaultLevel = mostRestrictive(GROUPED_IDS.map(::defaultLevel)),
        canInherit = true,
    )

    private fun setListTool(draft: PermissionDraft, key: String, level: String): PermissionDraft {
        if (key == GROUP_KEY) return setGrouped(draft, GROUPED_IDS, level)
        return setWildcard(draft, key, level)
    }

    private fun inheritListTool(draft: PermissionDraft, key: String): PermissionDraft {
        if (key == GROUP_KEY) return inheritGrouped(draft, GROUPED_IDS)
        return inheritWildcard(draft, key)
    }

    private companion object {
        const val GROUP_KEY = "todoread+todowrite"
    }
}
