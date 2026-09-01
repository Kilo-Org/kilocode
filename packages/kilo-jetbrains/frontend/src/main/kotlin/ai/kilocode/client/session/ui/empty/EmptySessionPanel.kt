package ai.kilocode.client.session.ui.empty

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionActivityKind
import ai.kilocode.client.session.controller.SessionController
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Align
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import ai.kilocode.rpc.dto.BranchStatusDto
import ai.kilocode.rpc.dto.GhAvailability
import ai.kilocode.rpc.dto.SessionDto
import com.intellij.icons.AllIcons
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.util.text.HtmlChunk
import com.intellij.openapi.util.text.StringUtil
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.Centerizer
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import com.intellij.xml.util.XmlStringUtil
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Cursor
import java.awt.Dimension
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import java.awt.event.HierarchyEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.SwingUtilities
import javax.swing.event.HyperlinkEvent
import javax.swing.event.HyperlinkListener

/**
 * Empty-session panel.
 *
 * The content is a BorderLayout panel, wrapped in a
 * [Align] (exposed as [view]) so callers need not know about centering.
 */
class EmptySessionPanel(
    parent: Disposable,
    private val controller: SessionController,
    recents: List<SessionDto>,
    private val history: () -> Unit = {},
    private val activity: () -> Map<String, SessionActivityKind> = { emptyMap() },
    private val titles: () -> Map<String, String> = { emptyMap() },
    private val browse: (String) -> Unit = BrowserUtil::browse,
    private val timers: UiTimerSource = UiTimers,
    private val minimal: Boolean = false,
    private val newWorktree: (() -> Unit)? = null,
) : BorderLayoutPanel(), Disposable, SessionEditorStyleTarget {
    private var style = SessionEditorStyle.current()
    val view: Align = align(
        HAlign.CENTER,
        VAlign.CENTER,
        maxW = { SessionUiStyle.SessionLayout.readableWidth(this, style.transcriptFont) },
    )

    private val timer = timers.timer(ACTIVITY_MS) { syncActivity() }
    internal val recent = RecentsList(recents, controller)

    private val historyButton = ShowHistoryButton().apply {
        addActionListener { history() }
    }

    /**
     * Branch/worktree status behind the tip under the logo. Null until [setBranch] delivers it, so
     * the first paint falls back to the generic welcome rather than flashing a wrong claim.
     */
    private var branch: BranchStatusDto? = null

    private val feedback = EmptySessionFeedback(browse)

    private val logo = JBLabel(
        IconLoader.getIcon("/icons/kilo-content.svg", EmptySessionPanel::class.java),
    ).apply {
        horizontalAlignment = JBLabel.CENTER
    }

    /**
     * Text is set by [syncTip], which picks the generic welcome or a branch/worktree tip. Copyable
     * mode swaps the label's internals for an HTML pane, which is what makes the inline worktree
     * link clickable; auto-wrapping must be set first so that pane's CSS allows line breaks.
     */
    private val welcomeLabel = object : JBLabel() {
        override fun createHyperlinkListener() = HyperlinkListener { e ->
            if (e.eventType != HyperlinkEvent.EventType.ACTIVATED) return@HyperlinkListener
            if (e.description == WORKTREE_HREF) newWorktree?.invoke()
        }
    }.apply {
        foreground = SessionUiStyle.Text.Secondary.foreground()
        horizontalAlignment = JBLabel.CENTER
        setAllowAutoWrapping(true)
        setCopyable(true)
    }

    private val description = object : BorderLayoutPanel() {
        override fun getPreferredSize(): Dimension {
            val size = super.getPreferredSize()
            return Dimension(JBUI.scale(SessionUiStyle.RecentSessions.DESCRIPTION_WIDTH), size.height)
        }

        override fun getMaximumSize(): Dimension {
            val size = super.getMaximumSize()
            return Dimension(JBUI.scale(SessionUiStyle.RecentSessions.DESCRIPTION_WIDTH), size.height)
        }
    }.apply {
        isOpaque = false
        border = JBUI.Borders.empty(UiStyle.Gap.lg(), 0, UiStyle.Gap.lg(), 0)
        add(welcomeLabel, BorderLayout.CENTER)
    }

    private val descriptionSlot = description.align(HAlign.CENTER, VAlign.CENTER)

    private val header = BorderLayoutPanel(0, UiStyle.Gap.pad()).apply {
        isOpaque = false
        add(logo, BorderLayout.NORTH)
    }

    init {
        Disposer.register(parent, this)
        Disposer.register(this, feedback)
        isOpaque = false
        applyStyle(SessionEditorStyle.current())
        addHierarchyListener { e ->
            if (e.changeFlags and HierarchyEvent.SHOWING_CHANGED.toLong() == 0L) return@addHierarchyListener
            if (isShowing) {
                syncActivity()
                timer.start()
                return@addHierarchyListener
            }
            timer.stop()
        }

        val gap = UiStyle.Gap.pad()
        layout = BorderLayout(0, gap)

        val actions = Stack.vertical(gap = UiStyle.Gap.lg())
        if (!minimal) actions.next(Centerizer(historyButton, Centerizer.TYPE.HORIZONTAL))
        actions.next(Centerizer(feedback.button, Centerizer.TYPE.HORIZONTAL))
        val south = BorderLayoutPanel().apply {
            isOpaque = false
            add(actions, BorderLayout.CENTER)
        }

        add(header, BorderLayout.NORTH)
        if (!minimal && recent.hasSessions()) add(recent, BorderLayout.CENTER)
        add(south, BorderLayout.SOUTH)
        syncTip()
    }

    /**
     * Applies the branch/worktree status behind the tip under the logo. Called again whenever the
     * status is refreshed, so it must stay a no-op when nothing changed.
     */
    @RequiresEdt
    fun setBranch(status: BranchStatusDto?) {
        if (branch == status) return
        branch = status
        syncTip()
    }

    /**
     * The tip under the logo, as an HTML fragment: an isolation reminder on a worktree, a nudge
     * towards one on a plain checkout, where "run it in a worktree" is an inline link. Null when the
     * status is unknown, git is missing, or no branch is checked out — the generic welcome covers
     * those rather than asserting something wrong.
     */
    private fun tip(): String? {
        val status = branch ?: return null
        if (status.availability == GhAvailability.GIT_MISSING) return null
        val name = name()?.let { XmlStringUtil.escapeString(it) }
        if (status.worktree) {
            return name?.let { KiloBundle.message("session.empty.worktree", it) }
                ?: KiloBundle.message("session.empty.worktree.unknown")
        }
        if (name == null) return null
        return KiloBundle.message("session.empty.branch", name, worktreePhrase())
    }

    /**
     * "run it in a worktree" as a link, or as plain text on surfaces that cannot open the flow, so
     * the sentence reads the same either way.
     */
    private fun worktreePhrase(): String {
        val phrase = KiloBundle.message("session.empty.branch.link")
        if (newWorktree == null) return XmlStringUtil.escapeString(phrase)
        return HtmlChunk.link(WORKTREE_HREF, phrase).toString()
    }

    /** Branch name trimmed to fit the fixed-width description, or null when there is no branch. */
    private fun name(): String? {
        val value = branch?.branch?.trim().orEmpty()
        if (value.isEmpty() || value == DETACHED) return null
        return StringUtil.shortenTextWithEllipsis(value, BRANCH_MAX, 0, true)
    }

    @RequiresEdt
    private fun syncTip() {
        val tip = tip()
        welcomeLabel.text = centeredHtml(
            tip ?: XmlStringUtil.escapeString(KiloBundle.message("session.empty.welcome")),
        )
        // Minimal surfaces (worktree/subagent editor tabs) skip the generic blurb but still want a
        // state-specific tip, so the slot is attached on demand instead of once at construction.
        val described = tip != null || !minimal
        if (described && descriptionSlot.parent == null) header.add(descriptionSlot, BorderLayout.CENTER)
        if (!described && descriptionSlot.parent != null) header.remove(descriptionSlot)
        revalidate()
        repaint()
    }

    internal fun recentCount() = recent.count()

    internal fun selectRecent(index: Int) {
        recent.select(index)
    }

    internal fun selectedRecent() = recent.selected()

    internal fun clickRecent(index: Int) {
        recent.click(index)
    }

    internal fun clickShowHistory() {
        historyButton.doClick()
    }

    internal fun showHistoryText() = historyButton.text

    internal fun feedbackText() = KiloBundle.message("feedback.button")

    internal fun feedbackCursor() = feedback.button.cursor.type

    internal fun feedbackIcon() = feedback.button.icon

    internal fun feedbackBorderPainted() = feedback.button.isBorderPainted

    internal fun feedbackContent(open: (String) -> Unit = {}): JComponent = EmptySessionFeedback.content(open)

    internal fun feedbackUrls() = EmptySessionFeedback.urls()

    internal fun showHistoryBorderPainted() = historyButton.isBorderPainted

    internal fun showHistoryCursor() = historyButton.cursor.type

    internal fun recentVisible() = !minimal && recent.hasSessions()

    internal fun historyVisible() = SwingUtilities.isDescendingFrom(historyButton, this)

    internal fun feedbackVisible() = SwingUtilities.isDescendingFrom(feedback.button, this)

    internal fun descriptionVisible() = SwingUtilities.isDescendingFrom(welcomeLabel, this)

    internal fun logoVisible() = SwingUtilities.isDescendingFrom(logo, this)

    internal fun explanationText() = KiloBundle.message("session.empty.welcome")

    /** The tip as the user reads it, with the inline link's markup stripped. */
    internal fun tipText() = tip()?.let { StringUtil.removeHtmlTags(it) }

    /** The plain text currently under the logo: the state-specific tip, or the generic welcome. */
    internal fun descriptionText() = tipText() ?: KiloBundle.message("session.empty.welcome")

    internal fun worktreeLinked() = tip()?.contains("href=\"$WORKTREE_HREF\"") == true

    internal fun worktreeHref() = WORKTREE_HREF

    internal fun welcomeLabelAlignment() = welcomeLabel.horizontalAlignment

    internal fun descriptionPreferredSize() = description.preferredSize

    internal fun descriptionMaximumSize() = description.maximumSize

    internal fun historyButtonPreferredWidth() = historyButton.preferredSize.width

    internal fun initialized() = true

    internal fun loadingVisible() = false

    internal fun activeView() = getComponent(0)

    internal fun text(session: SessionDto, now: Long = timers.now()) =
        recent.text(session, now)

    internal fun rendererComponent(
        session: SessionDto,
        selected: Boolean = false,
        hover: Boolean = false,
    ): Component {
        return recent.renderer(session, selected, hover)
    }

    @RequiresEdt
    internal fun syncActivity() {
        recent.sync(activity(), titles())
    }

    internal open class ShowHistoryButton(
        text: String = KiloBundle.message("session.showHistory"),
        icon: javax.swing.Icon = AllIcons.Vcs.History,
    ) : JButton(text, icon) {
        private var over = false

        init {
            isFocusable = false
            setRequestFocusEnabled(false)
            isContentAreaFilled = false
            isBorderPainted = false
            isOpaque = false
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
            addMouseListener(object : MouseAdapter() {
                override fun mouseEntered(e: MouseEvent) {
                    sync(true)
                }

                override fun mouseExited(e: MouseEvent) {
                    sync(false)
                }
            })
        }

        override fun paintComponent(g: Graphics) {
            if (isEnabled && over) {
                val g2 = g.create() as Graphics2D
                try {
                    g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
                    g2.color = JBUI.CurrentTheme.ActionButton.hoverBackground()
                    val arc = JBUI.scale(JBUI.getInt("Button.arc", 6))
                    g2.fillRoundRect(0, 0, width, height, arc, arc)
                } finally {
                    g2.dispose()
                }
            }
            super.paintComponent(g)
        }

        private fun sync(value: Boolean) {
            if (over == value) return
            over = value
            repaint()
        }
    }

    override fun dispose() {
        timer.stop()
    }

    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        welcomeLabel.font = style.regularFont
        recent.applyStyle(style)
        revalidate()
        repaint()
    }

    /** [body] must already be escaped or generated HTML — this only wraps and centers it. */
    private fun centeredHtml(body: String) = XmlStringUtil.wrapInHtml(
        "<div style='text-align:center'>$body</div>"
    )

    private companion object {
        const val ACTIVITY_MS = 3_000

        /** Keeps a long branch name from wrapping the fixed-width description into a wall of text. */
        const val BRANCH_MAX = 28
        const val DETACHED = "(detached)"

        /** Href of the inline worktree link; matched in the label's hyperlink listener. */
        const val WORKTREE_HREF = "worktree"
    }
}
