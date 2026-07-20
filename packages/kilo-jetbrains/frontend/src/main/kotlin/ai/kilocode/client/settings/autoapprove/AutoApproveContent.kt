package ai.kilocode.client.settings.autoapprove

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.BaseContentPanel
import ai.kilocode.client.settings.base.SettingsRow
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
) : BaseContentPanel() {
    private val granular = GRANULAR_TOOLS.map { (id, kind) -> id to granularSection(id, kind) }

    private val grouped = LevelSelect(
        { level -> update { setGrouped(this, GROUPED_IDS, level) } },
        { update { inheritGrouped(this, GROUPED_IDS) } },
    )

    private val simple = SIMPLE_TOOLS.associateWith { id -> simpleSelect(id) }
    private val trailing = TRAILING_TOOLS.associateWith { id -> simpleSelect(id) }

    init {
        granular.forEach { (_, section) -> next(section) }

        val rows = section(KiloBundle.message("settings.autoApprove.title"))
        for (id in SIMPLE_TOOLS) {
            rows.row(SettingsRow(toolTitle(id), KiloBundle.message("settings.autoApprove.tool.$id"), simple.getValue(id)))
        }
        rows.row(SettingsRow(
            "Todoread / Todowrite",
            KiloBundle.message("settings.autoApprove.tool.todoreadwrite"),
            grouped,
        ))
        for (id in TRAILING_TOOLS) {
            rows.row(SettingsRow(toolTitle(id), KiloBundle.message("settings.autoApprove.tool.$id"), trailing.getValue(id)))
        }
    }

    @RequiresEdt
    fun sync(draft: PermissionDraft, enabled: Boolean) {
        for ((id, section) in granular) section.sync(draft.rules[id], enabled)
        for ((id, select) in simple) select.sync(effectiveLevel(draft, id), inheritedWildcard(draft.rules[id]), enabled)
        grouped.sync(
            mostRestrictive(GROUPED_IDS.map { effectiveLevel(draft, it) }),
            GROUPED_IDS.all { inheritedWildcard(draft.rules[it]) },
            enabled,
        )
        for ((id, select) in trailing) select.sync(effectiveLevel(draft, id), inheritedWildcard(draft.rules[id]), enabled)
    }

    private fun granularSection(tool: String, kind: ExceptionKind): GranularToolSection {
        val wildcardKey = if (kind == ExceptionKind.COMMAND) "commands" else "paths"
        val addKey = if (kind == ExceptionKind.COMMAND) "addCommand" else "addPath"
        val placeholderKey = if (kind == ExceptionKind.COMMAND) "placeholder.command" else "placeholder.path"
        return GranularToolSection(
            tool,
            KiloBundle.message("settings.autoApprove.tool.$tool"),
            KiloBundle.message("settings.autoApprove.wildcardLabel.$wildcardKey"),
            KiloBundle.message("settings.autoApprove.$addKey"),
            KiloBundle.message("settings.autoApprove.$placeholderKey"),
            { level -> update { setWildcard(this, tool, level) } },
            { update { inheritWildcard(this, tool) } },
            { pattern -> update { addException(this, tool, pattern) } },
            { pattern, level -> update { setException(this, tool, pattern, level) } },
            { patterns -> update { removeExceptions(this, tool, patterns) } },
        )
    }

    private fun simpleSelect(tool: String): LevelSelect = LevelSelect(
        { level -> update { setWildcard(this, tool, level) } },
        { update { inheritWildcard(this, tool) } },
    )
}
