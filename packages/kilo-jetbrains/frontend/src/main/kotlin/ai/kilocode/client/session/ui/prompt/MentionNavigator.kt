package ai.kilocode.client.session.ui.prompt

import ai.kilocode.client.plugin.KiloBundle
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.IdeActions
import com.intellij.openapi.editor.colors.EditorColors
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.editor.event.EditorMouseEvent
import com.intellij.openapi.editor.event.EditorMouseListener
import com.intellij.openapi.editor.event.EditorMouseMotionListener
import com.intellij.openapi.editor.ex.EditorEx
import com.intellij.openapi.editor.markup.HighlighterLayer
import com.intellij.openapi.editor.markup.HighlighterTargetArea
import com.intellij.openapi.editor.markup.RangeHighlighter
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.util.SystemInfo
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Cursor
import java.awt.event.MouseEvent

/**
 * Makes resolved `@file` mentions behave like the platform's "Go to File":
 *
 * - Holding the navigation modifier (Cmd on macOS, Ctrl elsewhere) and hovering a resolved
 *   mention paints it as a hyperlink and shows the hand cursor; clicking opens the file.
 * - Go to Declaration (Cmd-B / Ctrl-B) opens the mention under the caret.
 * - Hovering an unresolved (red) mention shows a tooltip explaining why it cannot be resolved.
 *
 * Implemented locally on the frontend editor — like completion and undo here — because the
 * platform navigation machinery targets the backend-shared editor in split mode.
 */
internal class MentionNavigator(
    private val editor: EditorEx,
    private val provider: KiloPromptCompletionProvider,
) : EditorMouseListener, EditorMouseMotionListener {

    private var link: RangeHighlighter? = null

    @RequiresEdt
    fun install() {
        editor.addEditorMouseListener(this)
        editor.addEditorMouseMotionListener(this)
        val base = ActionManager.getInstance().getAction(IdeActions.ACTION_GOTO_DECLARATION) ?: return
        object : DumbAwareAction(KiloBundle.message("prompt.mention.goto")) {
            override fun actionPerformed(e: AnActionEvent) {
                val hit = provider.mentionAt(editor.document.text, editor.caretModel.offset) ?: return
                if (hit.resolved) provider.navigate(hit.value)
            }
        }.registerCustomShortcutSet(base.shortcutSet, editor.contentComponent)
    }

    override fun mouseMoved(e: EditorMouseEvent) {
        val hit = if (e.isOverText) provider.mentionAt(editor.document.text, e.offset) else null
        syncTooltip(hit)
        syncLink(hit, e.mouseEvent)
    }

    override fun mouseClicked(e: EditorMouseEvent) {
        if (!modifier(e.mouseEvent) || !e.isOverText) return
        val hit = provider.mentionAt(editor.document.text, e.offset) ?: return
        if (!hit.resolved) return
        e.consume()
        provider.navigate(hit.value)
    }

    override fun mouseExited(e: EditorMouseEvent) {
        syncTooltip(null)
        clearLink()
    }

    private fun syncTooltip(hit: KiloPromptCompletionProvider.MentionHit?) {
        val text = hit?.takeIf { !it.resolved }?.let { KiloBundle.message("prompt.mention.unresolved", it.value) }
        if (editor.contentComponent.toolTipText != text) editor.contentComponent.toolTipText = text
    }

    private fun syncLink(hit: KiloPromptCompletionProvider.MentionHit?, mouse: MouseEvent) {
        val active = hit?.takeIf { it.resolved && modifier(mouse) }
        if (active == null) {
            clearLink()
            return
        }
        if (link?.startOffset == active.start && link?.endOffset == active.end) return
        clearLink()
        val attributes = EditorColorsManager.getInstance().globalScheme.getAttributes(EditorColors.REFERENCE_HYPERLINK_COLOR)
        link = editor.markupModel.addRangeHighlighter(
            active.start,
            active.end,
            HighlighterLayer.HYPERLINK,
            attributes,
            HighlighterTargetArea.EXACT_RANGE,
        )
        editor.setCustomCursor(MentionNavigator::class.java, Cursor.getPredefinedCursor(Cursor.HAND_CURSOR))
    }

    private fun clearLink() {
        link?.let(editor.markupModel::removeHighlighter)
        link = null
        editor.setCustomCursor(MentionNavigator::class.java, null)
    }

    private fun modifier(e: MouseEvent) = if (SystemInfo.isMac) e.isMetaDown else e.isControlDown
}
