package ai.kilocode.client.ui.active

import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.LiveBadgeIcon
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.LayoutPass
import com.intellij.ui.AnimatedIcon
import com.intellij.util.ui.JBUI
import java.awt.Component
import java.awt.Color
import java.awt.Rectangle
import java.awt.Container
import java.awt.Cursor
import javax.swing.Icon
import javax.swing.SwingUtilities
import javax.swing.UIManager
import com.intellij.util.ui.UIUtil

private const val CELL_GAP = 8

/**
 * A pill or status glyph rendered before or after an [ActiveItem] title. A non-null [id] opts the
 * badge into hit-testing; [action] requires an id to have any effect.
 *
 * [segments] joins multiple worded pills into one badge. An [icon] replaces the pill rather than joining
 * it, so a badge is either worded or a glyph. The glyph form is how a row shows a status that already has
 * a settled visual language — a CI or review verdict — where a worded pill would only repeat what the icon
 * already says.
 *
 * A glyph may still be labelled: an [icon] with a non-blank [text] renders the two side by side, in the
 * muted row color rather than a pill's own. That is the form for a status whose icon says what is being
 * counted and whose text says how many — where the icon alone would report that something is outstanding
 * without saying how much of it.
 */
internal data class ActiveBadge(
    val text: String,
    val style: UiStyle.Badge.Style = UiStyle.Badge.Secondary,
    val id: String? = null,
    val tooltip: String? = null,
    val action: (() -> Unit)? = null,
    val icon: Icon? = null,
    val segments: List<FilledBadgeIcon.Segment> = emptyList(),
) {
    internal fun parts() = segments.ifEmpty { listOf(FilledBadgeIcon.Segment(text, style)) }
}

/**
 * A row's changes summary: what the row has committed against [base], and what it has left uncommitted.
 * A row with nothing committed shows the uncommitted counts instead of hiding, so [onLocal] is the click
 * target in that case and [onChanges] the rest of the time.
 */
internal data class ActiveMetrics(
    val files: Int = 0,
    val additions: Int = 0,
    val deletions: Int = 0,
    val base: String = "",
    /** The committed counts no longer merge into [base]. Marks the summary rather than changing it. */
    val conflict: Boolean = false,
    val onChanges: (() -> Unit)? = null,
    val localFiles: Int = 0,
    val localAdditions: Int = 0,
    val localDeletions: Int = 0,
    val onLocal: (() -> Unit)? = null,
) {
    /** Whether the uncommitted counts are standing in for a committed set that is empty. */
    val local: Boolean get() = files == 0 && localFiles > 0

    /** The one action the summary answers to, matched to whichever counts it is showing. */
    val action: (() -> Unit)? get() = if (local) onLocal else onChanges
}

internal enum class ActiveRowHeight { EQUAL, PREFERRED }

internal enum class ActiveWeight { PLAIN, BOLD }

internal enum class ActiveIconAlignment { CENTER, TOP }

internal data class ActiveConfig(
    val height: ActiveRowHeight = ActiveRowHeight.EQUAL,
    val description: Boolean = true,
    val descriptionIndent: Boolean = true,
    val tooltip: Boolean = true,
    val iconAlignment: ActiveIconAlignment = ActiveIconAlignment.CENTER,
    val hoverActions: Boolean = false,
    /**
     * Keep a selected row's in-place action cells visible while focus sits outside the list.
     *
     * Off by default, so a list only shows actions on the focused selection. Turn it on for a list
     * whose actions open a dialog or move focus elsewhere (MCP sign-in, skill editing): the actions
     * would otherwise disappear from under the pointer as soon as the click moved focus away.
     */
    val keepActions: Boolean = false,
    /** Weight used for the primary row title. */
    val title: ActiveWeight = ActiveWeight.BOLD,
    /**
     * Pin title-line [ActiveItem.badges] to the row's trailing edge instead of letting them trail
     * the title text. Turn it on for status glyphs, which are scanned down the list as a column and
     * then line up with the metrics on the description line; leave it off for pills that label the
     * title ("builtin", "env"), which read as part of it and would be covered by the hover actions.
     */
    val badgesRight: Boolean = false,
    /**
     * Wrap the description line to its full height instead of clipping/fading it to one line.
     * Only meaningful together with [ActiveRowHeight.PREFERRED]: a wrapped body under
     * [ActiveRowHeight.EQUAL] would still be capped to the shared row height.
     */
    val wrapDescription: Boolean = false,
) {
    companion object {
        val Equal = ActiveConfig(ActiveRowHeight.EQUAL)
        val Preferred = ActiveConfig(ActiveRowHeight.PREFERRED)
    }
}

internal data class ActiveCell(
    val id: String,
    val label: String,
    val enabled: Boolean = true,
    /** Show this button even when the row is not the active focused selection. */
    val alwaysVisible: Boolean = false,
    val icon: Icon? = null,
    val iconOnly: Boolean = false,
    val primary: Boolean = false,
    /** Hover tooltip; falls back to [label] when null. */
    val tooltip: String? = null,
    /** Cursor shown while hovering the button; defaults to the action (hand) cursor. */
    val cursor: Int = Cursor.HAND_CURSOR,
    /**
     * Click handler; when set it replaces the list-level onCell callback for this cell. Defaults to
     * null so existing cells keep routing through onCell and stay value-equal across row rebuilds.
     * A per-cell handler must be a stable reference when the owning list relies on row equality to
     * skip rebuilds.
     */
    val action: (() -> Unit)? = null,
)

/**
 * A component in a rendered [ActiveItem] row that the list hit-tests for clicks, hover cursor,
 * and tooltips.
 */
internal interface ActiveHitCell {
    val cellId: String
    fun cellEnabled(): Boolean
    fun cellCursor(): Int
    fun cellTooltip(): String?
    fun cellAction(): (() -> Unit)?
}

/**
 * A row in an [ActiveList]. Carries the display contract shared by settings pages, the worktree
 * list, and the session history stack: a leading icon, a title whose weight follows
 * [ActiveConfig.title] with an inline [note], a secondary [description] line, [leading] badges
 * before the title, inline [badges] after it, optional right-aligned [trailing] text, and action
 * [cells]. Action cells are shown for the selected row, including while the list is unfocused.
 * [ActiveCell.alwaysVisible] also exposes an action on unselected rows.
 */
internal interface ActiveItem {
    val key: String
    /**
     * Stable identity used to restore selection across refreshes. Defaults to [key]; override when
     * the key is not stable for the row's lifetime.
     */
    val identity: Any get() = key
    val title: String
    val note: String? get() = null
    val description: String? get() = null
    /** Hover tooltip text; defaults to [description] when not overridden. */
    val tooltip: String? get() = description
    val doubleClick: String? get() = null
    val icon: Icon? get() = null
    /**
     * Recolor [icon] to the row foreground when the row is the focused selection. Enable it only for
     * monochrome glyphs that should read as part of the highlighted text; leave it off for colored
     * status icons (running, question, error) so they keep their own hue.
     */
    val tinted: Boolean get() = false
    val leading: List<ActiveBadge> get() = emptyList()
    /** Badges rendered after the title. */
    val badges: List<ActiveBadge> get() = emptyList()
    val secondaryBadges: List<ActiveBadge> get() = emptyList()
    /** Right-aligned secondary text, such as a relative timestamp. */
    val trailing: String? get() = null
    val metrics: ActiveMetrics? get() = null
    val cells: List<ActiveCell> get() = emptyList()
    val disabled: Boolean get() = false
    /** Non-null while a background operation owns this row; the text is shown trailing. */
    val progress: String? get() = null
    /** Extra text matched by the filter field in addition to [title]; null matches title only. */
    val search: String? get() = null
}


internal fun activeVisibleCells(
    item: ActiveItem,
    active: Boolean,
    menu: Boolean = false,
): List<ActiveCell> {
    if (item.disabled) return emptyList()
    if (item.progress != null) return emptyList()
    val cells = item.cells.filter { active || it.alwaysVisible }
    if (!menu) return cells
    return cells + activeMenuCell()
}

internal fun activeVisibleCells(item: ActiveItem, active: Boolean): List<ActiveCell> {
    return activeVisibleCells(item, active, false)
}

internal fun activeCellGap() = JBUI.scale(CELL_GAP)

/**
 * Whether [item] paints an animated glyph anywhere in its row, so an animation frame has to repaint it.
 *
 * Runs per visible row on every animation frame, so this checks each badge list directly instead of wrapping
 * them in a `listOf(...)` first — the wrapper and its iterator would otherwise be allocated every frame.
 */
internal fun activeAnimated(item: ActiveItem): Boolean {
    if (animated(item.icon)) return true
    if (item.cells.any { animated(it.icon) }) return true
    if (item.leading.any { animated(it.icon) }) return true
    if (item.badges.any { animated(it.icon) }) return true
    return item.secondaryBadges.any { animated(it.icon) }
}

private fun animated(icon: Icon?): Boolean = when (icon) {
    is AnimatedIcon -> true
    is LiveBadgeIcon -> animated(icon.icon)
    else -> false
}


/** Lays out [component] top-down as one [LayoutPass], so an invalidated stamp is measured once per container. */
internal fun activeLayout(component: Component) {
    LayoutPass.measure { layoutActive(component) }
}

private fun layoutActive(component: Component) {
    if (component !is Container) return
    component.doLayout()
    for (child in component.components) layoutActive(child)
}

/**
 * Marks a rendered row and everything under it invalid.
 *
 * A renderer stamp is one component reused for every row, and it changes content without changing
 * size. Swing caches each container's preferred/minimum size and skips valid subtrees, so a row would
 * otherwise be laid out with sizes measured for whichever row the renderer rendered before it.
 */
internal fun activeInvalidate(component: Component) {
    component.invalidate()
    if (component is Container) for (child in component.components) activeInvalidate(child)
}

internal enum class ActiveSurface {
    Default,
    ToolWindow,
}

/**
 * What a refresh should do with the selection. Every policy keeps the rows the user last selected
 * when they survive the refresh, and none of them scrolls in that case; they differ only in what
 * happens once those rows are gone.
 */
internal sealed interface ActiveSelection {
    data object Preserve : ActiveSelection
    data object Slide : ActiveSelection
    data class Key(val key: String) : ActiveSelection
}

internal class ActiveReorder(
    val movable: (ActiveItem) -> Boolean = { true },
    val onMove: (ActiveMove) -> Unit,
)

internal data class ActiveMove(
    val key: String,
    val from: Int,
    val to: Int,
    val keys: List<String>,
)


/** A hit-tested region of a rendered row, in host coordinates, with its interaction metadata. */
internal class ActiveHit(
    val id: String,
    val bounds: Rectangle,
    val enabled: Boolean,
    val cursor: Int,
    val tooltip: String?,
    val action: (() -> Unit)?,
)

/** Hit regions of a rendered row, offset into the host's coordinate space. */
internal fun activeHitCells(component: Component, x: Int, y: Int): List<ActiveHit> {
    val out = mutableListOf<ActiveHit>()
    fun visit(c: Component) {
        if (!c.isVisible) return
        if (c is ActiveHitCell && c.cellId.isNotBlank()) {
            val origin = SwingUtilities.convertPoint(c, 0, 0, component)
            out += ActiveHit(
                c.cellId,
                Rectangle(x + origin.x, y + origin.y, c.width, c.height),
                c.cellEnabled(),
                c.cellCursor(),
                c.cellTooltip(),
                c.cellAction(),
            )
        }
        if (c is Container) c.components.forEach(::visit)
    }
    visit(component)
    return out
}

internal fun activeToolWindowBackground(): Color =
    UIManager.getColor("ToolWindow.background") ?: UIUtil.getPanelBackground()

/** Refreshes theme fonts/colors on a renderer stamp that is not part of a window's component tree. */
internal fun activeUpdateUI(component: Component) {
    if (component is javax.swing.JComponent) component.updateUI()
    if (component is Container) component.components.forEach(::activeUpdateUI)
}
