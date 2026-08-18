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

/** Ids for the trailing metrics badges hit-tested in place (see [ActiveListMetrics]). */
internal const val ACTIVE_LIST_CHANGES_CELL = "__changes__"
internal const val ACTIVE_LIST_PR_CELL = "__pr__"

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
