package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionFileLinks
import ai.kilocode.client.session.SessionFileOpener
import ai.kilocode.client.session.anchor
import ai.kilocode.client.session.model.Text
import ai.kilocode.client.session.model.FileAttachment
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.md.MdCodeBlockFactory
import ai.kilocode.client.ui.md.MdCodeBlockOptions
import ai.kilocode.client.ui.md.MdView
import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import ai.kilocode.client.ui.UiStyle
import java.awt.Color
import java.awt.Cursor
import java.awt.Dimension
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants

class PromptView(
    text: Text,
    private val openFile: SessionFileOpener = { _, _ -> },
    private val openAttachment: (FileAttachment) -> Unit = {},
    openUrl: (String) -> Unit = {},
    selection: SessionSelection? = null,
    mentions: List<PromptMention> = emptyList(),
) : TextView(
    text,
    transparent = true,
    openFile = openFile,
    openUrl = openUrl,
    selection = selection,
    code = MdCodeBlockFactory(
        MdCodeBlockOptions(
            maxLines = SessionUiStyle.View.Prompt.PASTE_BLOCK_LINES,
            verticalPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
            horizontalPadding = 0,
        )
    ),
) {

    private var mentions = mentions
    private val buffer = StringBuilder(text.content)

    /**
     * Whether the reader expanded this bubble. A clip cannot be expressed through containment the
     * way an attached/detached card body can — the content stays mounted either way — so the toggle
     * state lives here.
     */
    private var expanded = false
    private val clip = Clip()

    // Reads its color on every paint so it follows a Look and Feel change, and so the theme lookup
    // does not run from the superclass constructor's applyStyle pass, before this field exists.
    private val toggle = object : JBLabel() {
        override fun getForeground(): Color = UIUtil.getContextHelpForeground()
    }

    init {
        border = JBUI.Borders.empty(
            JBUI.scale(SessionUiStyle.View.Prompt.SHELL_VERTICAL_PADDING),
            JBUI.scale(SessionUiStyle.View.Prompt.SHELL_HORIZONTAL_PADDING),
        )
        // The markdown moves into a clip that shows only its top while collapsed; the toggle sits
        // below it so it stays visible instead of being clipped away with the content.
        remove(md.component)
        clip.add(md.component)
        toggle.cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        toggle.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) = toggle()
        })
        add(Stack.vertical(gap = UiStyle.Gap.sm()).next(clip).next(toggle), BorderLayout.CENTER)
        sync()
    }

    /** Expands a clipped bubble, or clips an expanded one back down. */
    @RequiresEdt
    fun toggle() {
        expanded = !expanded
        syncToggle()
        refresh()
    }

    @RequiresEdt
    fun isExpanded() = expanded

    @RequiresEdt
    internal fun toggleControl(): JComponent = toggle

    override fun update(content: Content) {
        if (content !is Text) return
        buffer.clear()
        buffer.append(content.content)
        sync()
    }

    override fun appendDelta(delta: String) {
        if (delta.isEmpty()) return
        buffer.append(delta)
        sync()
    }

    fun setMentions(list: List<PromptMention>) {
        if (mentions == list) return
        mentions = list
        sync()
    }

    override fun onLink(event: MdView.LinkEvent) {
        val mention = mentions.firstOrNull { it.path == event.href || path(it.path) == event.href }
        if (mention != null) {
            mention.attachment?.let {
                openAttachment(it)
                return
            }
            openFile(mention.path, event.anchor())
            return
        }
        super.onLink(event)
    }

    override fun applyStyle(style: SessionEditorStyle) {
        super.applyStyle(style)
        val color = style.editorScheme.getAttributes(DefaultLanguageHighlighterColors.METADATA)?.foregroundColor
        if (color == null || md.linkColor == color) return
        md.linkColor = color
    }

    override fun styleFont(style: SessionEditorStyle) = style.transcriptFont

    override fun styleBackground(style: SessionEditorStyle) = SessionUiStyle.View.Prompt.bgColor(style)

    private fun sync() {
        md.set(linkifyMentions(buffer.toString(), mentions))
        syncToggle()
        refresh()
    }

    /**
     * Shows the toggle only when there is content hidden by the clip, and labels it for the
     * direction the click will move.
     */
    @RequiresEdt
    private fun syncToggle() {
        val on = clip.overflows()
        if (toggle.isVisible != on) toggle.isVisible = on
        if (!on) {
            // Nothing left to reveal, so a bubble that shrank back below the cap is not left
            // stuck in the expanded state.
            expanded = false
            return
        }
        val key = if (expanded) "prompt.transcript.collapse" else "prompt.transcript.expand"
        val text = KiloBundle.message(key)
        if (toggle.text != text) toggle.text = text
        val icon = if (expanded) SessionViewIcons.chevronExpanded else SessionViewIcons.chevronCollapsed
        if (toggle.icon !== icon) toggle.icon = icon
    }

    /**
     * Shows the top of the markdown and clips the rest.
     *
     * Swing paints children clipped to their parent's bounds, so laying the content out at its full
     * height inside a shorter panel hides the overflow without reflowing or squeezing it — which is
     * what a layout manager would do if it were handed the reduced height instead.
     */
    private inner class Clip : JPanel(null) {
        private val child: JComponent get() = getComponent(0) as JComponent

        init {
            isOpaque = false
        }

        override fun doLayout() {
            if (componentCount == 0) return
            child.setBounds(0, 0, width, maxOf(child.preferredSize.height, height))
        }

        /** Whether the content is taller than the collapsed cap, so the toggle has work to do. */
        fun overflows(): Boolean {
            if (componentCount == 0 || !child.isVisible) return false
            return child.preferredSize.height > cap()
        }

        override fun getPreferredSize(): Dimension {
            if (componentCount == 0) return super.getPreferredSize()
            val pref = child.preferredSize
            if (expanded || !child.isVisible) return pref
            return Dimension(pref.width, minOf(pref.height, cap()))
        }

        override fun getMinimumSize(): Dimension = Dimension(0, preferredSize.height)

        override fun getMaximumSize(): Dimension = Dimension(Int.MAX_VALUE, preferredSize.height)

        private fun cap(): Int =
            getFontMetrics(md.font).height * SessionUiStyle.View.Prompt.COLLAPSED_LINES
    }

    private fun path(value: String) = value.replace(" ", "%20").replace("(", "%28").replace(")", "%29")

    override fun dumpLabel() = "PromptView#$contentId"
}
