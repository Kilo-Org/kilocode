package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Permission
import ai.kilocode.client.session.ui.SessionView
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyleTarget
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.rpc.dto.PermissionReplyDto
import com.intellij.icons.AllIcons
import com.intellij.ui.dsl.builder.RightGap
import com.intellij.ui.dsl.builder.RowLayout
import com.intellij.ui.dsl.builder.panel
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout

/**
 * Transcript-style permission view — rendered inside [ai.kilocode.client.session.ui.SessionMessageListPanel]
 * at the end of the transcript when the session is in
 * [ai.kilocode.client.session.model.SessionState.AwaitingPermission].
 *
 * Unlike the old docked [ai.kilocode.client.session.ui.PermissionPanel], this view lives inside
 * the scrollable transcript so the user can scroll through prior messages while a permission is pending.
 */
class PermissionView(
    private val reply: (String, PermissionReplyDto) -> Unit,
) : BorderLayoutPanel(), SessionEditorStyleTarget, SessionView {
    override val sessionViewKind = SessionView.Kind.Default

    private var requestId: String? = null
    private var style = SessionEditorStyle.current()

    init {
        isOpaque = false
        isVisible = false
    }

    /** Populate the view for [permission] and make it visible. */
    fun show(permission: Permission) {
        requestId = permission.id
        val patterns = permission.patterns.joinToString(", ").ifEmpty { "*" }

        removeAll()

        val card = BorderLayoutPanel()
        card.isOpaque = true
        card.background = SessionUiStyle.View.surface()
        card.border = SessionUiStyle.View.card()

        card.add(panel {
            row {
                icon(AllIcons.General.Warning).gap(RightGap.SMALL)
                label(KiloBundle.message("session.permission.title")).bold()
            }
            row {
                label(KiloBundle.message("session.permission.meta", permission.name, patterns))
            }
            val msg = permission.message
            if (!msg.isNullOrBlank()) {
                row {
                    comment(msg)
                }
            }
            row {
                button(KiloBundle.message("session.permission.allow")) { decide("once") }.gap(RightGap.SMALL)
                button(KiloBundle.message("session.permission.deny")) { decide("reject") }
            }.layout(RowLayout.INDEPENDENT)
        }.also { it.isOpaque = false }, BorderLayout.CENTER)

        add(card, BorderLayout.CENTER)

        isVisible = true
        refresh()
    }

    /** Hide this view and clear the active request id. */
    fun hideView() {
        requestId = null
        removeAll()
        isVisible = false
        refresh()
    }

    override fun applyStyle(style: SessionEditorStyle) {
        this.style = style
    }

    private fun decide(value: String) {
        val id = requestId ?: return
        reply(id, PermissionReplyDto(reply = value))
        hideView()
    }

    private fun refresh() {
        revalidate()
        repaint()
        parent?.revalidate()
        parent?.repaint()
    }
}
