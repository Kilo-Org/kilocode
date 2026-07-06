package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.FileAttachment
import ai.kilocode.client.session.ui.attachment.AttachmentCard
import ai.kilocode.client.session.ui.attachment.AttachmentCardItem
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.views.base.PartView
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.Dimension
import javax.swing.ScrollPaneConstants

class PromptAttachmentView(
    messageId: String,
    private val openAttachment: (FileAttachment) -> Unit,
) : PartView() {
    override val contentId: String = "attachments:$messageId"

    private val items = LinkedHashMap<String, FileAttachment>()
    private val cards = LinkedHashMap<String, AttachmentCard>()
    private val row = Stack.horizontal(gap = UiStyle.Gap.sm())
    private val scroll = JBScrollPane(row).apply {
        border = null
        isOpaque = false
        viewport.isOpaque = false
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED
        verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_NEVER
    }

    init {
        isOpaque = false
        border = JBUI.Borders.empty(
            0,
            JBUI.scale(SessionUiStyle.View.Prompt.SHELL_HORIZONTAL_PADDING),
            JBUI.scale(SessionUiStyle.View.Prompt.SHELL_VERTICAL_PADDING),
            JBUI.scale(SessionUiStyle.View.Prompt.SHELL_HORIZONTAL_PADDING),
        )
        add(scroll)
    }

    fun contains(id: String) = items.containsKey(id)

    fun isEmpty() = items.isEmpty()

    fun ids(): List<String> = items.keys.toList()

    fun scrollPane(): JBScrollPane = scroll

    @RequiresEdt
    fun upsert(item: FileAttachment) {
        val old = items[item.id]
        items[item.id] = item
        if (old != null && same(old, item)) return
        val next = card(item)
        val prev = cards.put(item.id, next)
        if (prev == null) {
            row.next(next)
            refresh()
            return
        }
        val at = row.components.indexOfFirst { it === prev }.takeIf { it >= 0 } ?: return refresh()
        row.remove(prev)
        row.add(next, at)
        refresh()
    }

    @RequiresEdt
    fun remove(id: String): Boolean {
        val item = items.remove(id) ?: return false
        cards.remove(item.id)?.let { row.remove(it) }
        refresh()
        return true
    }

    override fun update(content: Content) {
        if (content is FileAttachment) upsert(content)
    }

    override fun getPreferredSize(): Dimension {
        val ins = insets
        val pref = scroll.preferredSize
        return Dimension(0, pref.height + bar() + ins.top + ins.bottom)
    }

    override fun getMinimumSize() = preferredSize

    override fun doLayout() {
        val ins = insets
        scroll.setBounds(
            ins.left,
            ins.top,
            maxOf(0, width - ins.left - ins.right),
            maxOf(0, height - ins.top - ins.bottom),
        )
    }

    override fun dispose() {
        row.removeAll()
        cards.clear()
        items.clear()
    }

    override fun dumpLabel(): String = "PromptAttachmentView#$contentId[${items.keys.joinToString(",")}]"

    private fun refresh() {
        revalidate()
        repaint()
    }

    private fun card(item: FileAttachment) = AttachmentCard(
        AttachmentCardItem(name(item), item.mime, item.url),
        open = { openAttachment(item) },
    )

    private fun same(a: FileAttachment, b: FileAttachment) = a.mime == b.mime && a.url == b.url && a.filename == b.filename

    private fun bar() = scroll.horizontalScrollBar.preferredSize.height

    private fun name(item: FileAttachment) = item.filename?.takeIf { it.isNotBlank() }
        ?: tail(item.url).takeIf { it.isNotBlank() }
        ?: "attachment"

    private fun tail(value: String): String {
        val clean = value.trimEnd('/', '\\')
        val index = maxOf(clean.lastIndexOf('/'), clean.lastIndexOf('\\'))
        if (index < 0) return clean
        return clean.substring(index + 1)
    }
}
