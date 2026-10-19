package ai.kilocode.client.ui.list

import ai.kilocode.client.plugin.KiloBundle
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.DataContext

internal const val ACTIVE_LIST_SECTION_CELL = "__section__"

/**
 * Opt-in switch for collapsible section separators, supplied by a list's owner. Present — non-null on
 * the [ActiveList] — is what turns the feature on; the loaded set is the sections that start collapsed,
 * and [save] receives the set again on every toggle so the owner can persist it.
 * [actions] optionally supplies platform toolbar buttons for each section, using [context] for updates
 * and invocation. Buttons remain available when the section is collapsed.
 */
internal class ActiveListCollapse(
    val load: () -> Set<String> = { emptySet() },
    val save: (Set<String>) -> Unit = {},
    val actions: (String) -> List<AnAction> = { emptyList() },
    val context: () -> DataContext = { DataContext.EMPTY_CONTEXT },
)

/**
 * The band-only row that stands in for a collapsed section: one row carrying the separator caption and
 * the chevron, in place of every row the section hides.
 *
 * [title] carries the composed caption rather than the bare section name, so the height key — which
 * compares [ActiveListItem.title] — invalidates when the hidden-row count changes. [disabled] keeps the
 * row out of the drag source, the context menu and the action cells, while the chevron still resolves
 * through the list's hit-with-action path.
 */
internal data class ActiveListSectionRow(
    override val section: String,
    override val title: String,
) : ActiveListItem {
    override val key: String get() = sectionKey(section)
    override val identity: Any get() = key
    override val disabled: Boolean get() = true
}

internal fun sectionKey(section: String) = "$ACTIVE_LIST_SECTION_CELL:$section"

/**
 * Replaces each collapsed contiguous run of rows sharing a [ActiveListItem.section] with one
 * [ActiveListSectionRow] headed by [caption], leaving every other row where it was. Sectionless rows —
 * the rows above the first separator — are never collapsed, because there is no separator to click.
 */
internal fun activeListCollapseRows(
    rows: List<ActiveListItem>,
    collapsed: Set<String>,
    caption: (String, Int) -> String,
): List<ActiveListItem> {
    if (collapsed.isEmpty()) return rows
    // Group on the section label only, not on the full run: a run stops at the next row with a
    // different section, which is exactly what collapsing a separator means.
    val out = mutableListOf<ActiveListItem>()
    var idx = 0
    while (idx < rows.size) {
        val section = rows[idx].section
        if (section == null || section !in collapsed) {
            out += rows[idx]
            idx++
            continue
        }
        val run = activeListSectionRun(rows, idx)
        out += ActiveListSectionRow(section, caption(section, run.last - run.first + 1))
        idx = run.last + 1
    }
    return out
}

internal fun activeListSectionCaption(section: String, count: Int) = KiloBundle.message("list.section.collapsed", section, count)
