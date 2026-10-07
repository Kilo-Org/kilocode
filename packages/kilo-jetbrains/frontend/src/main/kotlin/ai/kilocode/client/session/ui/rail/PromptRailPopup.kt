package ai.kilocode.client.session.ui.rail

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.HoverIcon
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.list.ActiveList
import ai.kilocode.client.ui.list.ActiveListConfig
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.client.ui.list.ActiveListRowHeight
import ai.kilocode.client.ui.popup.SidePopupContent
import com.intellij.icons.AllIcons
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout
import java.awt.Cursor
import java.awt.Dimension
import javax.swing.JComponent

/**
 * Balloon body for the prompt navigator: a header with first/latest jump buttons, and every navigable
 * prompt as a row in the shared [ActiveList], so the navigator reads and behaves like the worktree,
 * history, and settings lists.
 *
 * This implements [SidePopupContent] directly rather than wrapping
 * [ai.kilocode.client.session.ui.popup.HeaderPopupBody]. That wrapper supplies its own scroll pane, and
 * nesting [ActiveList] inside it left two scroll panes with neither owning the scrolling: the wrapper
 * measures wrapped content by sizing it to `Short.MAX_VALUE`, which propagated down and gave the inner
 * viewport a ~32k extent, so every row counted as visible and revealing one scrolled nowhere. Here the
 * list's own scroll pane is the only one, and [capped] clamps the body so that pane actually clips.
 */
internal class PromptRailPopup(
    private val items: List<PromptRailItem>,
    hovered: Int,
    /**
     * Navigate to a row. The flag is the list's `focus` signal: false for a single click, true for a
     * double click or Enter, which the navigator treats as a committed pick and so also closes on.
     */
    onSelect: (PromptRailItem, Boolean) -> Unit,
    onFirst: () -> Unit,
    onLatest: () -> Unit,
) : SidePopupContent {
    /** One navigable prompt as a standard list row: the prompt is the title, its answer the description. */
    private data class Row(
        override val key: String,
        override val title: String,
        override val description: String?,
    ) : ActiveListItem

    private val disposer = Disposer.newDisposable("PromptRailPopup")

    /** Row to reveal once the list has been laid out, or -1. See [reveal]. */
    private var pending = -1
    private var cap = Dimension(
        JBUI.scale(SessionUiStyle.View.Popup.MAX_WIDTH),
        JBUI.scale(SessionUiStyle.View.Popup.MAX_HEIGHT),
    )

    private val rows = ActiveList(
        emptyText = "",
        cfg = ActiveListConfig(
            // A prompt and the start of its answer both need their own line, and the answer wraps.
            height = ActiveListRowHeight.PREFERRED,
            wrapDescription = true,
            // The row already shows the answer preview it would repeat, and a tooltip inside a balloon
            // that itself opened on hover reads as a surface stacked on a surface.
            tooltip = false,
        ),
        showSearch = false,
        // Left at open-on-click so a single click reaches onOpen. With it off, ActiveListView's click
        // path falls through to the (absent) onClick handler and returns, so only a double click would
        // jump — the navigator is a one-click list.
        //
        // Enter commits unconditionally. The default provider reports the global
        // `edit.source.on.enter.key.request.focus.in.editor` advanced setting, which would make Enter
        // close the card on some installs and leave it open on others.
        enter = { true },
        onCell = { _, _ -> },
        onOpen = { row, focus ->
            items.firstOrNull { it.id == row.key }?.let { onSelect(it, focus) }
        },
    ).apply {
        setListCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR))
        update(items.map(::row))
    }

    // Labelled for screen readers but deliberately without tooltips: the navigator opens on hover, so a
    // tooltip here would pop a second floating surface over the card the pointer is already inside.
    private val first = HoverIcon().apply {
        icon = AllIcons.Actions.MoveUp
        accessibleContext.accessibleName = KiloBundle.message("session.prompts.first")
        addActionListener { onFirst() }
    }

    private val latest = HoverIcon().apply {
        icon = AllIcons.Actions.MoveDown
        accessibleContext.accessibleName = KiloBundle.message("session.prompts.latest")
        addActionListener { onLatest() }
    }

    /**
     * Clamps the body to the room the balloon was given. Without the clamp the list's preferred height
     * is every row stacked, the balloon would be sized to that, and the list would never need to scroll.
     */
    private val capped = object : BorderLayoutPanel() {
        override fun getPreferredSize(): Dimension {
            val pref = super.getPreferredSize()
            // Width takes the room the balloon was given rather than the rows' natural width: a wrapping
            // row has no meaningful preferred width, and the navigator should read as a steady column.
            return Dimension(cap.width, pref.height.coerceAtMost(cap.height))
        }

        /**
         * Replays a reveal the body could not serve before it had bounds.
         *
         * Hooked here rather than on a resize listener: component events are posted to the event queue,
         * so a listener would reveal on a later turn of the EDT — the asynchrony this is meant to remove.
         * Laying out is the synchronous point at which the list first has a viewport to scroll in.
         */
        override fun doLayout() {
            super.doLayout()
            reveal()
        }
    }.apply {
        isOpaque = false
        addToTop(header())
        addToCenter(rows)
    }

    override val component: JComponent get() = capped
    override val disposable get() = disposer
    override val background get() = UiStyle.Balloon.bg()

    override fun fitWithin(width: Int, height: Int) {
        cap = Dimension(width, height)
        capped.invalidate()
    }

    /** The row list, for tests that need to drive layout or inspect selection. */
    internal val list get() = rows

    init {
        select(hovered)
    }

    /**
     * Highlights the prompt at [index], and brings its row into view when [scroll] is set. Safe before
     * the balloon has been laid out and safe to repeat with the same row, so it can be called on every
     * tick hover.
     *
     * Clicking a row passes `scroll = false`. The row was reachable under the pointer, so moving the
     * list to re-centre it would shift the content out from under a deliberate click; the list is only
     * scrolled for navigation the user cannot aim, which is a tick hover or a first/latest jump.
     */
    @RequiresEdt
    fun select(index: Int, scroll: Boolean = true) {
        val key = items.getOrNull(index)?.id ?: return
        if (!scroll) {
            // Also drops any deferred reveal, so an earlier request cannot fire on the next layout and
            // move the list after the click.
            pending = -1
            rows.select(key, scroll = false)
            return
        }
        pending = index
        reveal()
    }

    /**
     * Applies [pending], or leaves it pending while the list has no bounds to scroll within.
     *
     * `ScrollingUtil.ensureIndexIsVisible` measures the viewport extent, so running it against an
     * unsized list resolves to no movement and the request would be silently dropped.
     */
    @RequiresEdt
    private fun reveal() {
        val index = pending
        if (index < 0) return
        if (rows.width <= 0 || rows.height <= 0) return
        val key = items.getOrNull(index)?.id ?: return
        // Cleared before scrolling: selecting re-enters layout, and that pass must not scroll again.
        pending = -1
        // The list lays out its own scroll pane, and the extent has to be settled before it is measured.
        rows.validate()
        rows.select(key)
    }

    private fun row(item: PromptRailItem) = Row(
        key = item.id,
        title = if (item.queued) "${KiloBundle.message("session.queued")} · ${item.prompt}" else item.prompt,
        description = item.answer.ifBlank { KiloBundle.message("session.prompts.noAnswer") },
    )

    private fun header() = BorderLayoutPanel().apply {
        isOpaque = false
        border = JBUI.Borders.empty(4, 5, 4, 11)
        add(
            JBLabel(KiloBundle.message("session.prompts.navLabel")).apply {
                foreground = UIUtil.getContextHelpForeground()
            },
            BorderLayout.WEST,
        )
        add(Stack.horizontal(UiStyle.Gap.xs()).next(first).next(latest), BorderLayout.EAST)
    }
}
