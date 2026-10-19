package ai.kilocode.client.settings.transcript

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Message
import ai.kilocode.client.session.model.Reasoning
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolApproval
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.model.toolKind
import ai.kilocode.client.session.settings.TranscriptDisplay
import ai.kilocode.client.session.ui.SessionLayout
import ai.kilocode.client.session.ui.SessionLayoutPanel
import ai.kilocode.client.session.ui.SessionRootPanel
import ai.kilocode.client.session.ui.popup.HeaderPopupController
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.MessageView
import ai.kilocode.client.session.views.ReasoningView
import ai.kilocode.client.session.views.tool.EditToolView
import ai.kilocode.client.session.views.tool.ShellToolView
import ai.kilocode.client.session.views.tool.ToolView
import ai.kilocode.client.util.UiTimer
import ai.kilocode.client.util.UiTimerSource
import ai.kilocode.client.util.UiTimers
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.BorderLayout
import java.awt.Insets
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants
import javax.swing.SwingUtilities
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Live sample of the chat transcript shown under the Transcript settings. It renders one assistant
 * message through the same [MessageView] / `ViewFactory` pipeline the real chat uses, so the preview
 * cannot drift from the actual cards.
 *
 * [display] supplies the unsaved draft. [replay] clears the old cards and replays a fresh sample under
 * that draft, the same way new parts arrive in a live session.
 */
internal class TranscriptPreview(
    private val display: () -> TranscriptDisplay,
    timers: UiTimerSource = UiTimers,
) : JPanel(BorderLayout()), Disposable {

    private val popup = HeaderPopupController(timers, enabled = { display().hoverPreview })
    private val style = SessionEditorStyle.current()
    private val message = previewMessage()
    private val view = MessageView(
        message,
        openFile = { _, _ -> },
        style = style,
        hover = { part, on -> if (on) popup.show(part) else popup.notifyExit(part) },
    )
    private val transcript = SessionLayoutPanel(
        SessionUiStyle.SessionLayout.GAP,
        Insets(
            SessionUiStyle.SessionLayout.INNER_TOP,
            SessionUiStyle.SessionLayout.INNER_HORIZONTAL,
            SessionUiStyle.SessionLayout.INNER_BOTTOM,
            SessionUiStyle.SessionLayout.INNER_HORIZONTAL,
        ),
    ).apply {
        // The real transcript caps its readable lane at 98 editor columns. The settings sample uses
        // half that lane and SessionLayout centers it in the full preview surface.
        (layout as? SessionLayout)?.maxWidth = { component ->
            SessionUiStyle.SessionLayout.readableWidth(component, style.transcriptFont) / 2
        }
        add(view)
    }
    private val scroll = JBScrollPane(transcript).apply {
        border = null
        isOpaque = false
        viewport.isOpaque = false
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
    }
    private var queue = emptyList<Content>()
    private var index = 0
    private val timer: UiTimer = timers.timer(PREVIEW_STEP_MS) { step() }

    init {
        isOpaque = false
        val backdrop = SessionRootPanel()
        // SessionRootPanel is a JLayeredPane with a null layout: children belong to its content panel,
        // which is also the only thing its preferred size measures.
        backdrop.content.add(scroll, BorderLayout.CENTER)
        add(backdrop, BorderLayout.CENTER)
        replay()
    }

    /** Clears the previous sample and replays fresh cards under the current draft. */
    @RequiresEdt
    fun replay() {
        timer.stop()
        popup.hideAll()
        view.partIds().forEach(view::removePart)
        message.parts.clear()
        queue = previewParts()
        index = 0
        step()
        if (index < queue.size) timer.start()
    }

    @RequiresEdt
    private fun step() {
        val part = queue.getOrNull(index++) ?: run {
            timer.stop()
            return
        }
        message.parts[part.id] = part
        view.upsertPart(part)
        val current = display()
        view.syncTranscriptDisplay(current, force = true)
        view.syncApprovalReasons(current.approvalReason)
        // The settings dialog is not driving a reflow pass of its own, so realize the new geometry here.
        view.revalidate()
        if (view.width > 0) view.doLayout()
        transcript.revalidate()
        if (transcript.width > 0) transcript.doLayout()
        scroll.viewport.revalidate()
        scroll.revalidate()
        revalidate()
        view.repaint()
        repaint()
        followBottom()
        if (index >= queue.size) timer.stop()
    }

    private fun followBottom() {
        SwingUtilities.invokeLater {
            val bar = scroll.verticalScrollBar
            bar.value = bar.maximum
        }
    }

    /** Test seam: the reasoning card rendered in the sample. */
    internal fun reasoningCard(): ReasoningView = first(ReasoningView::class.java)

    /** Test seam: the terminal card rendered in the sample. */
    internal fun shellCard(): ShellToolView = first(ShellToolView::class.java)

    /** Test seam: the code-edit card rendered in the sample. */
    internal fun editCard(): EditToolView = first(EditToolView::class.java)

    /** Test seam: the MCP / generic tool card rendered in the sample. */
    internal fun mcpCard(): ToolView = first(ToolView::class.java)

    /** Test seam: number of sample parts revealed by the current replay. */
    internal fun visibleCardCount(): Int = view.partIds().size

    /** Test seam: the real MessageView whose SessionLayout owns the card lane. */
    internal fun messageForTest(): MessageView = view

    /** Test seam: the transcript list that owns standard insets and the centered message lane. */
    internal fun transcriptForTest(): SessionLayoutPanel = transcript

    private fun <T : JComponent> first(type: Class<T>): T {
        val found = mutableListOf<T>()
        collect(this, type, found)
        return found.singleOrNull() ?: error("expected exactly one ${type.simpleName}, found ${found.size}")
    }

    private fun <T : JComponent> collect(component: java.awt.Component, type: Class<T>, found: MutableList<T>) {
        if (type.isInstance(component)) found.add(type.cast(component))
        if (component is java.awt.Container) component.components.forEach { collect(it, type, found) }
    }

    override fun dispose() {
        timer.stop()
        Disposer.dispose(popup)
        Disposer.dispose(view)
    }
}

private fun previewMessage() = Message(
    MessageDto(
        id = PREVIEW_MESSAGE_ID,
        sessionID = PREVIEW_MESSAGE_ID,
        role = "assistant",
        time = MessageTimeDto(created = 0.0, completed = 0.0),
    ),
)

private fun previewParts(): List<Content> = listOf(
    // Left streaming on purpose: a finished block reads the same in Preview and Headline, so only a
    // live one shows all three modes apart (full text, capped scroll, header only).
    Reasoning(PREVIEW_REASONING_ID).also {
        it.done = false
        it.content.append(KiloBundle.message("settings.transcript.preview.reasoning"))
    },
    bashTool(),
    editTool(),
    mcpTool(),
)

private fun bashTool() = Tool(PREVIEW_BASH_ID, "bash", toolKind("bash")).also {
    it.state = ToolExecState.COMPLETED
    it.input = mapOf("command" to KiloBundle.message("settings.transcript.preview.bash.command"))
    it.output = KiloBundle.message("settings.transcript.preview.bash.output")
    it.approval = ToolApproval(source = "rule", rulePattern = "bun test*", ruleAction = "allow")
}

private fun editTool() = Tool(PREVIEW_EDIT_ID, "edit", toolKind("edit")).also {
    it.state = ToolExecState.COMPLETED
    it.title = KiloBundle.message("settings.transcript.preview.edit.path")
    it.input = mapOf("filePath" to "/repo/${KiloBundle.message("settings.transcript.preview.edit.path")}")
    it.metadata = mapOf(
        "filediff" to buildJsonObject {
            put("file", KiloBundle.message("settings.transcript.preview.edit.path"))
            put("patch", PREVIEW_DIFF)
            put("additions", 6)
            put("deletions", 2)
        }.toString(),
    )
    it.output = KiloBundle.message("settings.transcript.preview.edit.output")
    it.approval = ToolApproval(source = "rule", rulePattern = "edit *", ruleAction = "allow")
}

private fun mcpTool() = Tool(PREVIEW_MCP_ID, "mcp__filesystem__read_text_file", toolKind("mcp__filesystem__read_text_file")).also {
    it.state = ToolExecState.COMPLETED
    it.title = KiloBundle.message("settings.transcript.preview.mcp.title")
    it.output = KiloBundle.message("settings.transcript.preview.mcp.output")
    it.approval = ToolApproval(source = "agent", agent = "code")
}

private const val PREVIEW_MESSAGE_ID = "transcript-preview"
private const val PREVIEW_REASONING_ID = "transcript-preview-reasoning"
private const val PREVIEW_BASH_ID = "transcript-preview-bash"
private const val PREVIEW_EDIT_ID = "transcript-preview-edit"
private const val PREVIEW_MCP_ID = "transcript-preview-mcp"
internal const val PREVIEW_STEP_MS = 500

private val PREVIEW_DIFF = """
    --- a/src/Settings.kt
    +++ b/src/Settings.kt
     @@ -1,8 +1,12 @@
      object Settings {
-        val transcriptPreview = false
-        val reasoningMode = "expanded"
+        val transcriptPreview = true
+        val reasoningMode = "preview"
+        val expandTerminal = false
+        val expandEdits = true
+        // Transcript preferences.
      fun apply() {
-            save()
+            saveTranscriptPreferences()
+            broadcastDisplayChange()
      }
      }
""".trimIndent()
