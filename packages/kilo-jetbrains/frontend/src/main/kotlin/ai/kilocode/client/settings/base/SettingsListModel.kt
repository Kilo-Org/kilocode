package ai.kilocode.client.settings.base

import ai.kilocode.client.ui.list.ActiveListActionCell
import ai.kilocode.client.ui.list.ActiveListActive
import ai.kilocode.client.ui.list.ActiveListBadge
import ai.kilocode.client.ui.list.ActiveListCell
import ai.kilocode.client.ui.list.ActiveListConfig
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListRenderer
import ai.kilocode.client.ui.list.ActiveListRowHeight
import ai.kilocode.client.ui.list.ActiveListSelection
import ai.kilocode.client.ui.list.ActiveListView
import ai.kilocode.client.ui.list.activeListCellAt
import ai.kilocode.client.ui.list.activeListCellBounds
import ai.kilocode.client.ui.list.activeListCellGap
import ai.kilocode.client.ui.list.activeListSectionTitle
import ai.kilocode.client.ui.list.activeListVisibleCells
import java.awt.Point
import java.awt.Rectangle
import javax.swing.JList

internal typealias SettingsBadge = ActiveListBadge
internal typealias SettingsListRowHeight = ActiveListRowHeight
internal typealias SettingsListConfig = ActiveListConfig
internal typealias SettingsListCell = ActiveListCell
internal typealias SettingsListItem = ActiveListItem
internal typealias SettingsListRenderer = ActiveListRenderer
internal typealias SettingsListActionCell = ActiveListActionCell
internal typealias SettingsListActive = ActiveListActive
internal typealias SettingsListView = ActiveListView
internal typealias SettingsListSelection = ActiveListSelection

internal fun settingsListSectionTitle(items: List<SettingsListItem>, index: Int): String? =
    activeListSectionTitle(items, index)

internal fun settingsListVisibleCells(item: SettingsListItem, selected: Boolean): List<SettingsListCell> =
    activeListVisibleCells(item, selected)

internal fun settingsListCellGap(): Int = activeListCellGap()

internal fun settingsListCellBounds(list: JList<*>, index: Int, selected: Boolean): Map<String, Rectangle> =
    activeListCellBounds(list, index, selected)

internal fun settingsListCellAt(list: JList<*>, index: Int, point: Point, selected: Boolean): String? =
    activeListCellAt(list, index, point, selected)
