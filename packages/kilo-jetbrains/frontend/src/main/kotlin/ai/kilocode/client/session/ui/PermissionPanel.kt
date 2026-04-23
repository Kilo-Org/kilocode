package ai.kilocode.client.session.ui

import ai.kilocode.client.session.SessionController
import ai.kilocode.client.session.model.Permission
import ai.kilocode.rpc.dto.PermissionReplyDto
import com.intellij.icons.AllIcons
import com.intellij.ui.JBColor
import com.intellij.ui.dsl.builder.RightGap
import com.intellij.ui.dsl.builder.RowLayout
import com.intellij.ui.dsl.builder.panel
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import javax.swing.JPanel
import javax.swing.border.MatteBorder

/**
 * Docked permission panel — shown above the prompt when the session is in
 * [ai.kilocode.client.session.model.SessionState.AwaitingPermission].
 *
 * The inner layout is built via Kotlin UI DSL inside [show] so it reflects
 * the current permission's tool, patterns, and optional message.
 *
 * Layout (mirrors VS Code's PermissionDock):
 * ```
 * ┌─────────────────────────────────────────┐
 * │  ⚠ Permission request                   │
 * │  Tool: edit  •  Patterns: *.kt          │
 * │  <optional message>                     │
 * │  [Allow]  [Deny]                        │
 * └─────────────────────────────────────────┘
 * ```
 */
class PermissionPanel(
    private val controller: SessionController,
) : JPanel(BorderLayout()) {

    private lateinit var requestId: String

    init {
        isOpaque = false
        border = JBUI.Borders.compound(
            MatteBorder(JBUI.scale(1), 0, 0, 0, JBColor.border()),
            JBUI.Borders.empty(JBUI.scale(6), JBUI.scale(8)),
        )
        isVisible = false
    }

    /** Populate the panel for [permission] and make it visible. */
    fun show(permission: Permission) {
        requestId = permission.id
        val patterns = permission.patterns.joinToString(", ").ifEmpty { "*" }

        removeAll()
        add(panel {
            row {
                icon(AllIcons.General.Warning).gap(RightGap.SMALL)
                label("Permission request").bold()
            }
            row {
                label("Tool: ${permission.name}   \u2022   Patterns: $patterns")
            }
            val msg = permission.message
            if (!msg.isNullOrBlank()) {
                row {
                    comment(msg)
                }
            }
            row {
                button("Allow") { decide("once") }.gap(RightGap.SMALL)
                button("Deny") { decide("reject") }
            }.layout(RowLayout.INDEPENDENT)
        }, BorderLayout.CENTER)

        isVisible = true
        revalidate()
        repaint()
    }

    /** Hide this panel. */
    fun hidePanel() {
        isVisible = false
    }

    private fun decide(reply: String) {
        controller.replyPermission(requestId, PermissionReplyDto(reply = reply))
        hidePanel()
    }
}
