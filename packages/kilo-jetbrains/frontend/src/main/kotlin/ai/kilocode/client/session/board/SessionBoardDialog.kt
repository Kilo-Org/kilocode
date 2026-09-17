package ai.kilocode.client.session.board

import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.list.ActiveList
import ai.kilocode.client.ui.list.ActiveListBadge
import ai.kilocode.client.ui.list.ActiveListItem
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.BoardMessageDto
import ai.kilocode.rpc.dto.SessionBoardDto
import com.intellij.ide.ui.laf.darcula.ui.DarculaButtonUI
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.wm.WindowManager
import com.intellij.ui.EditorNotificationPanel
import com.intellij.ui.InlineBanner
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBDimension
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.xml.util.XmlStringUtil
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Dimension
import javax.swing.Action
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JPanel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Viewer for a root session's shared agent board (see `ai.kilocode.jetbrains.client.session.SessionUi`
 * for the header icon / menu action that opens this). Pages backward through [KiloSessionService.sessionBoard]
 * and can clear the board via [KiloSessionService.resetSessionBoard], guarded by the loaded revision.
 *
 * [order] is the board's participant order (`main` first, then child sessions in spawn order — see
 * `ai.kilocode.client.session.model.SessionModel.childSessions`), used to give each participant a
 * stable, distinct avatar via [BoardAvatars].
 */
internal class SessionBoardDialog(
    parent: Component,
    private val project: Project,
    private val sessionId: String,
    private val sessionTitle: String?,
    private val directory: String,
    private val order: List<String>,
    private val service: KiloSessionService,
    private val onOpenAgent: (String, String?) -> Unit,
) : DialogWrapper(parent, false) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var disposed = false
    private var loading = false
    private var board: SessionBoardDto? = null

    /** Overridable in tests to avoid showing a real modal confirmation. */
    internal var confirmReset: (Project, String) -> Boolean = { proj, msg ->
        Messages.showYesNoDialog(
            proj,
            msg,
            KiloBundle.message("session.board.reset.title"),
            Messages.getWarningIcon(),
        ) == Messages.YES
    }

    private data class Row(
        override val key: String,
        override val title: String,
        override val description: String?,
        override val icon: javax.swing.Icon?,
        override val badges: List<ActiveListBadge>,
        val participant: String,
        val participantLabel: String?,
    ) : ActiveListItem

    // internal (not private): lets tests simulate real clicks/selection on the live list.
    internal val list = ActiveList(
        emptyText = KiloBundle.message("session.board.empty"),
        showSearch = false,
        onCell = { _, _ -> },
        onClick = { item -> (item as? Row)?.let(::openParticipant) },
    )

    internal val loadMoreButton = button(KiloBundle.message("session.board.loadMore")) { load(before = board?.cursor) }
    internal val resetButton = button(KiloBundle.message("session.board.reset.action")) { onReset() }
    private val closeButton = button(KiloBundle.message("session.board.close"), primary = true) { close(OK_EXIT_CODE) }
    private val status = JBLabel().apply {
        foreground = UIUtil.getErrorForeground()
        isVisible = false
    }

    /**
     * What the board is, as a platform info banner. Its message is an HTML `JEditorPane`, so the
     * text wraps on its own. Message text is set in [createCenterPanel], which knows the wrap width.
     */
    private val banner = InlineBanner("", EditorNotificationPanel.Status.Info).apply {
        showCloseButton(false)
    }

    /**
     * Reveals the long explanation. Sits in the banner's action row rather than inline in the
     * sentence because the banner installs its own [com.intellij.ui.BrowserHyperlinkListener] on a
     * message pane this class cannot reach, so an in-text `<a href>` would be treated as a URL.
     */
    private val toggle = banner.addAction(KiloBundle.message("session.board.showMore"), null) { flip() }

    private var expanded = false

    init {
        // Session name in the title bar; the board is always scoped to one session, so the window
        // title is where it belongs rather than competing with the explanation below.
        title = sessionTitle?.takeIf { it.isNotBlank() }
            ?.let { KiloBundle.message("session.board.title.session", it) }
            ?: KiloBundle.message("session.board.title")
        // Non-modal so the board can stay open while the session and its subagents keep working,
        // which is the point of watching it. Callers must use show(); showAndGet() throws on a
        // non-modal dialog.
        isModal = false
        init()
        load(before = null)
    }

    override fun createCenterPanel(): JComponent {
        list.preferredSize = JBDimension(0, DIALOG_HEIGHT)
        syncBanner()
        val panel = object : JPanel(BorderLayout()) {
            /**
             * Pack to the content's own width, clamped to between a third of the IDE frame and the
             * whole frame, so a board of short messages still opens wide enough to read and a board
             * of long ones never grows past the window behind it.
             */
            override fun getPreferredSize(): Dimension {
                val size = super.getPreferredSize()
                return Dimension(boardWidth(size.width, frameWidth()), size.height)
            }
        }
        panel.add(
            Stack.vertical(gap = UiStyle.Gap.sm()).next(banner).next(status).apply {
                border = JBUI.Borders.emptyBottom(UiStyle.Gap.pad())
            },
            BorderLayout.NORTH,
        )
        panel.add(list, BorderLayout.CENTER)
        return panel
    }

    private fun frameWidth(): Int =
        WindowManager.getInstance().getFrame(project)?.width ?: 0

    @RequiresEdt
    private fun flip() {
        expanded = !expanded
        syncBanner()
        // The banner grew or shrank by a paragraph, so the dialog has to re-measure.
        pack()
    }

    /**
     * Wrapped in a fixed-width div: an HTML pane otherwise reports the whole paragraph as one line
     * and would pin the dialog to the maximum width, defeating [boardWidth]'s packing.
     */
    @RequiresEdt
    private fun syncBanner() {
        val body = buildString {
            append(KiloBundle.message("session.board.intro"))
            if (expanded) append("<br><br>").append(KiloBundle.message("session.board.intro.more"))
        }
        banner.setMessage(XmlStringUtil.wrapInHtml("<div width='${boardWrap(frameWidth())}'>$body</div>"))
        toggle.text = KiloBundle.message(if (expanded) "session.board.showLess" else "session.board.showMore")
    }

    override fun createActions(): Array<Action> = emptyArray()

    override fun createSouthPanel(): JComponent = JPanel(BorderLayout()).apply {
        isOpaque = false
        border = JBUI.Borders.empty(UiStyle.Gap.pad())
        add(resetButton, BorderLayout.WEST)
        add(Stack.horizontal(gap = UiStyle.Gap.sm()).next(loadMoreButton).next(closeButton), BorderLayout.EAST)
    }

    // Deliberately no getDimensionServiceKey: a remembered width would defeat the frame-relative
    // clamp in createCenterPanel on every reopen.

    override fun dispose() {
        disposed = true
        scope.cancel()
        super.dispose()
    }

    private fun load(before: String?) {
        if (loading) return
        loading = true
        syncButtons()
        scope.launch {
            val result = runCatching { service.sessionBoard(sessionId, directory, before, PAGE_SIZE) }
            ui {
                loading = false
                result.onSuccess { applyPage(it, prepend = before != null) }
                result.onFailure { fail(KiloBundle.message("session.board.load.failed"), it) }
                syncButtons()
            }
        }
    }

    private fun applyPage(page: SessionBoardDto, prepend: Boolean) {
        val existing = board
        board = if (prepend && existing != null) existing.copy(
            messages = page.messages + existing.messages,
            cursor = page.cursor,
            hasMore = page.hasMore,
            revision = page.revision,
        ) else page
        hideError()
        list.update(board?.messages.orEmpty().map(::row))
    }

    private fun onReset() {
        val current = board ?: return
        if (!confirmReset(project, KiloBundle.message("session.board.reset.description"))) return
        loading = true
        syncButtons()
        scope.launch {
            val result = runCatching { service.resetSessionBoard(sessionId, directory, current.revision) }
            ui {
                loading = false
                result.onSuccess { updated ->
                    if (updated == null) {
                        showError(KiloBundle.message("session.board.reset.conflict"))
                        load(before = null)
                        return@onSuccess
                    }
                    board = updated
                    hideError()
                    list.update(updated.messages.map(::row))
                }
                result.onFailure { fail(KiloBundle.message("session.board.reset.failed"), it) }
                syncButtons()
            }
        }
    }

    private fun openParticipant(row: Row) {
        if (row.participant == "main" || row.participant == "ALL") return
        close(OK_EXIT_CODE)
        onOpenAgent(row.participant, row.participantLabel)
    }

    private fun row(message: BoardMessageDto): Row {
        val from = message.fromLabel ?: message.from
        val to = message.toLabel ?: message.to
        return Row(
            key = message.id,
            title = "$from \u2192 $to",
            description = message.body.replace("\n", " "),
            icon = BoardAvatars.icon(message.from, order),
            badges = listOf(ActiveListBadge(message.type)),
            participant = message.from,
            participantLabel = message.fromLabel,
        )
    }

    private fun syncButtons() {
        loadMoreButton.isVisible = board?.hasMore == true
        loadMoreButton.isEnabled = !loading
        resetButton.isEnabled = !loading && board?.messages?.isNotEmpty() == true
        closeButton.isEnabled = !loading
    }

    /**
     * Shows a short, readable reason and logs the cause. The RPC layer wraps failures in a
     * multi-line `Remote call ... Failure(...)` string with a full stack trace, so the raw
     * exception message must never reach the label.
     */
    private fun fail(message: String, err: Throwable) {
        LOG.warn("session board request failed session=$sessionId", err)
        showError(message)
    }

    private fun showError(message: String) {
        status.text = message
        status.isVisible = true
    }

    private fun hideError() {
        status.isVisible = false
    }

    // ModalityState.any() so these UI-only updates still run if a modal dialog is opened on top of
    // this non-modal one, instead of being deferred until that dialog closes.
    private fun ui(block: () -> Unit) {
        ApplicationManager.getApplication().invokeLater({ if (!disposed) block() }, ModalityState.any())
    }

    private fun button(text: String, primary: Boolean = false, action: () -> Unit): JButton {
        val btn = JButton(text)
        btn.isOpaque = false
        btn.putClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY, if (primary) true else null)
        btn.addActionListener { action() }
        return btn
    }

    private companion object {
        const val PAGE_SIZE = 20
        const val DIALOG_HEIGHT = 420
        val LOG = KiloLog.create(SessionBoardDialog::class.java)
    }
}

/** Wrap width when no IDE frame is available to measure against. */
private const val DEFAULT_WRAP = 460

/** Slack so the wrapped paragraph stays inside the dialog's own padding. */
private const val WRAP_INSET = 24

/**
 * Packed dialog width: the content's own width, but never narrower than a third of the IDE frame
 * and never wider than the frame itself. A [frame] of zero or less means no frame to measure
 * against, so the content decides.
 */
internal fun boardWidth(content: Int, frame: Int): Int =
    if (frame <= 0) content else content.coerceIn(frame / 3, frame)

/**
 * Width the intro paragraph wraps at. Pinned to the dialog's own minimum width so the HTML label
 * reports a wrapped height instead of one long line, which would otherwise force [boardWidth] to
 * the maximum on every open.
 */
internal fun boardWrap(frame: Int): Int {
    val base = if (frame > 0) frame / 3 else JBUI.scale(DEFAULT_WRAP)
    return (base - JBUI.scale(WRAP_INSET)).coerceAtLeast(JBUI.scale(WRAP_INSET))
}
