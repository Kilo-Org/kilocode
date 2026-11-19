package ai.kilocode.client.session.views

import ai.kilocode.client.session.SessionFileLinks
import ai.kilocode.client.session.SessionFileOpener
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.FileAttachment
import ai.kilocode.client.session.ui.attachment.AttachmentCard
import ai.kilocode.client.session.ui.attachment.AttachmentCardItem
import ai.kilocode.client.session.ui.attachment.AttachmentChip
import ai.kilocode.client.session.views.base.PartView
import ai.kilocode.client.ui.UiStyle
import com.intellij.util.ui.JBUI
import java.awt.FlowLayout
import java.net.URI
import java.nio.file.Path
import javax.swing.JComponent

class AttachmentView(
    private var item: FileAttachment,
    private val openAttachment: (FileAttachment) -> Unit,
) : PartView() {
    constructor(
        item: FileAttachment,
        openFile: SessionFileOpener,
        openUrl: (String) -> Unit,
    ) : this(item, { openDefault(it, openFile, openUrl) })

    override val contentId: String = item.id
    private var chip = chip(item)

    init {
        layout = FlowLayout(FlowLayout.LEFT, 0, UiStyle.Gap.xs())
        border = JBUI.Borders.empty(0, UiStyle.Gap.pad(), UiStyle.Gap.pad(), UiStyle.Gap.pad())
        add(chip)
    }

    override fun update(content: Content) {
        if (content !is FileAttachment) return
        if (same(content)) {
            item = content
            return
        }
        item = content
        remove(chip)
        chip = chip(content)
        add(chip)
        revalidate()
        repaint()
    }

    override fun dumpLabel(): String = "AttachmentView#${item.id}:${name(item)}"

    private fun chip(item: FileAttachment): JComponent {
        val card = AttachmentCardItem(name(item), item.mime, item.url)
        if (item.mime.startsWith("image/")) return AttachmentCard(card, open = { openAttachment(item) })
        return AttachmentChip(card, file = file(item), startLine = item.startLine, endLine = item.endLine, open = { openAttachment(item) })
    }

    private fun same(next: FileAttachment) = item.mime == next.mime &&
        item.url == next.url &&
        item.filename == next.filename &&
        item.startLine == next.startLine &&
        item.endLine == next.endLine

    private fun file(item: FileAttachment): Boolean {
        if (item.source?.path?.isNotBlank() == true) return true
        val uri = runCatching { URI.create(item.url) }.getOrNull() ?: return false
        return uri.scheme == "file"
    }

    companion object {
        fun openDefault(item: FileAttachment, openFile: SessionFileOpener, openUrl: (String) -> Unit) {
            val url = item.url.takeIf { it.isNotBlank() } ?: return
            val uri = runCatching { URI.create(url) }.getOrNull() ?: return
            if (uri.scheme == "file") {
                val path = runCatching { Path.of(clean(uri)).toString() }.getOrNull() ?: return
                openFile(href(path, item), null)
                return
            }
            if (SessionFileLinks.isFileHref(url)) {
                openFile(url, null)
                return
            }
            openUrl(url)
        }

        private fun href(path: String, item: FileAttachment): String {
            val start = item.startLine ?: return path
            val end = item.endLine ?: start
            return "$path:$start-$end"
        }

        private fun clean(uri: URI): URI = URI(uri.scheme, uri.authority, uri.path, null, null)
    }

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
