package ai.kilocode.client.ui.list

import ai.kilocode.client.plugin.KiloBundle
import com.intellij.icons.AllIcons

/**
 * Standard hover action-cell ids and factories shared by the reveal-on-hover lists (the worktree
 * list, the worktree-session editor list, and session history). Centralising them keeps the
 * pencil/trash buttons — their ids, icons, and `iconOnly` treatment — identical across every list
 * instead of each panel re-declaring `"rename"`/`"delete"` and rebuilding the same [ActiveListCell].
 */
internal const val ACTIVE_LIST_RENAME_CELL = "rename"
internal const val ACTIVE_LIST_DELETE_CELL = "delete"
internal const val ACTIVE_LIST_MENU_CELL = "__menu__"

/** Well-known ids for rich badges hit-tested in place. */
internal const val ACTIVE_LIST_CHANGES_CELL = "__changes__"

internal fun activeListRegions(item: ActiveListItem): Map<String, () -> Unit> {
    if (item.progress != null) return emptyMap()
    val out = linkedMapOf<String, () -> Unit>()
    for (badge in item.leading + item.badges + item.secondaryBadges) {
        val id = badge.id
        val act = badge.action
        if (!id.isNullOrBlank() && act != null) out[id] = act
    }
    item.metrics?.onChanges?.let { out[ACTIVE_LIST_CHANGES_CELL] = it }
    return out
}

internal fun activeListRenameCell(label: String = KiloBundle.message("common.rename")) = ActiveListCell(
    ACTIVE_LIST_RENAME_CELL,
    label,
    icon = AllIcons.Actions.Edit,
    iconOnly = true,
)

internal fun activeListDeleteCell(label: String = KiloBundle.message("common.delete")) = ActiveListCell(
    ACTIVE_LIST_DELETE_CELL,
    label,
    icon = AllIcons.Actions.GC,
    iconOnly = true,
)

internal fun activeListMenuCell(label: String = KiloBundle.message("common.more.actions")) = ActiveListCell(
    ACTIVE_LIST_MENU_CELL,
    label,
    icon = AllIcons.Actions.More,
    iconOnly = true,
)
