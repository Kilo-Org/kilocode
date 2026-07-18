package ai.kilocode.client.session.ui.model

import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.picker.PickerListRenderer
import com.intellij.icons.AllIcons
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.CollectionListModel
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.JBUI
import java.awt.FlowLayout
import java.awt.Point
import java.awt.Rectangle
import javax.swing.Icon
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.SwingConstants

private const val FAVORITE_CLICK_AREA_WIDTH = 32

internal class ModelPickerRenderer private constructor(
    model: CollectionListModel<ModelPickerRow>,
    active: () -> String?,
    private val favorites: () -> Set<String>,
    private val parts: Parts,
) : PickerListRenderer<ModelPickerRow>(
    model = model,
    checked = { it.key == active() },
    sectionTitle = ::modelPickerSectionTitle,
    content = parts.head,
    trailing = parts.star,
) {
    constructor(
        model: CollectionListModel<ModelPickerRow>,
        active: () -> String?,
        favorites: () -> Set<String>,
    ) : this(model, active, favorites, Parts.create())

    companion object {
        val DATA_COLLECTED: Icon = IconLoader.getIcon("/icons/book-open-check.svg", ModelPickerRenderer::class.java)
        val checked: Icon = PickerListRenderer.checkedIcon
        val empty: Icon = PickerListRenderer.emptyIcon

        fun isFavoriteClick(list: JList<*>, bounds: Rectangle, point: Point): Boolean {
            return PickerListRenderer.trailingClickZone(list, bounds, point, FAVORITE_CLICK_AREA_WIDTH)
        }
    }

    override fun getListCellRendererComponent(
        list: JList<out ModelPickerRow>,
        value: ModelPickerRow,
        index: Int,
        selected: Boolean,
        focused: Boolean,
    ): JPanel {
        return super.getListCellRendererComponent(list, value, index, selected, focused) as JPanel
    }

    override fun update(
        value: ModelPickerRow,
        index: Int,
        selected: Boolean,
        focused: Boolean,
        foreground: java.awt.Color,
        weak: java.awt.Color,
    ) {
        parts.title.clear()
        val item = value.item
        if (item == null) {
            parts.title.append(value.emptyText, SimpleTextAttributes(SimpleTextAttributes.STYLE_BOLD, foreground))
            parts.badgeLabel.isVisible = false
            parts.byokLabel.isVisible = false
            parts.warn.isVisible = false
            parts.provider.isVisible = false
            parts.star.icon = EmptyIcon.ICON_16
            return
        }
        val name = ModelText.parts(item)
        if (name.provider != null) {
            parts.title.append(name.provider, SimpleTextAttributes(SimpleTextAttributes.STYLE_PLAIN, weak))
            parts.title.append(" ", SimpleTextAttributes(SimpleTextAttributes.STYLE_PLAIN, weak))
        }
        parts.title.append(name.model, SimpleTextAttributes(SimpleTextAttributes.STYLE_BOLD, foreground))

        parts.warn.isVisible = ModelText.collectsData(item)
        parts.badgeLabel.isVisible = item.free && !item.byok
        parts.byokLabel.isVisible = item.byok
        parts.provider.isVisible = value.favorite
        parts.provider.text = item.providerName
        parts.provider.foreground = weak
        parts.provider.border = JBUI.Borders.emptyLeft(JBUI.CurrentTheme.ActionsList.elementIconGap())

        val fav = item.key in favorites()
        parts.star.icon = when {
            fav -> AllIcons.Nodes.Favorite
            selected -> AllIcons.Nodes.NotFavoriteOnHover
            else -> EmptyIcon.ICON_16
        }
    }

    internal fun starIcon(): Icon? = parts.star.icon

    internal fun badgeVisible(): Boolean = parts.badgeLabel.isVisible

    internal fun badgeText(): String = parts.badge.text

    internal fun byokVisible(): Boolean = parts.byokLabel.isVisible

    internal fun warningVisible(): Boolean = parts.warn.isVisible

    internal fun warningTooltip(): String? = parts.warn.toolTipText

    private class BadgeLabel(icon: Icon) : JBLabel(icon)

    private data class Parts(
        val title: SimpleColoredComponent,
        val badge: FilledBadgeIcon,
        val badgeLabel: BadgeLabel,
        val byokLabel: BadgeLabel,
        val warn: JBLabel,
        val provider: JBLabel,
        val star: JBLabel,
        val head: JPanel,
    ) {
        companion object {
            fun create(): Parts {
                val title = SimpleColoredComponent()
                val badge = FilledBadgeIcon(ModelText.freeLabel(), UiStyle.Badge.Highlight)
                val badgeLabel = BadgeLabel(badge).apply {
                    border = JBUI.Borders.emptyLeft(JBUI.CurrentTheme.ActionsList.elementIconGap())
                }
                val byok = FilledBadgeIcon("BYOK", UiStyle.Badge.Highlight)
                val byokLabel = BadgeLabel(byok).apply {
                    border = JBUI.Borders.emptyLeft(JBUI.CurrentTheme.ActionsList.elementIconGap())
                }
                val warn = JBLabel(DATA_COLLECTED).apply {
                    toolTipText = ModelText.dataCollected()
                    border = JBUI.Borders.emptyLeft(JBUI.CurrentTheme.ActionsList.elementIconGap())
                }
                val provider = JBLabel()
                val star = JBLabel().apply {
                    horizontalAlignment = SwingConstants.CENTER
                    verticalAlignment = SwingConstants.CENTER
                }
                val head = JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)).apply {
                    add(title)
                    add(warn)
                    add(badgeLabel)
                    add(byokLabel)
                    add(provider)
                }
                UiStyle.Components.transparent(title, head, warn, provider, star)
                return Parts(title, badge, badgeLabel, byokLabel, warn, provider, star, head)
            }
        }
    }
}
