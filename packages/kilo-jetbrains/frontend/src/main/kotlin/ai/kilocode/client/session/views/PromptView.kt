package ai.kilocode.client.session.views

import ai.kilocode.client.session.SessionFileLinks
import ai.kilocode.client.session.SessionFileOpener
import ai.kilocode.client.session.anchor
import ai.kilocode.client.session.model.Text
import ai.kilocode.client.session.model.FileAttachment
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.prompt.collapsible
import ai.kilocode.client.session.ui.prompt.placeholder
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.ui.md.MdCodeBlockFactory
import ai.kilocode.client.ui.md.MdCodeBlockOptions
import ai.kilocode.client.ui.md.MdView
import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.util.ui.JBUI
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
            // A block big enough to have been folded in the input is folded here too, behind the
            // same placeholder, so a sent message reads the same way it was composed.
            fold = { if (collapsible(it)) placeholder(it) else null },
        )
    ),
) {

    private var mentions = mentions
    private val buffer = StringBuilder(text.content)

    init {
        border = JBUI.Borders.empty(
            JBUI.scale(SessionUiStyle.View.Prompt.SHELL_VERTICAL_PADDING),
            JBUI.scale(SessionUiStyle.View.Prompt.SHELL_HORIZONTAL_PADDING),
        )
        sync()
    }

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
        refresh()
    }

    private fun path(value: String) = value.replace(" ", "%20").replace("(", "%28").replace(")", "%29")

    override fun dumpLabel() = "PromptView#$contentId"
}
