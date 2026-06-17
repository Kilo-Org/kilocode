package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.FileAttachment
import ai.kilocode.client.session.ui.attachment.AttachmentCard
import ai.kilocode.client.session.ui.attachment.AttachmentCardItem
import ai.kilocode.client.session.views.base.PartView
import ai.kilocode.client.ui.UiStyle
import com.intellij.util.ui.JBUI
import java.awt.FlowLayout
import java.net.URI
import java.nio.file.Path

class AttachmentView(
    private var item: FileAttachment,
    private val openAttachment: (FileAttachment) -> Unit,
) : PartView() {
    constructor(
        item: FileAttachment,
        openFile: (String) -> Unit,
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

    private fun chip(item: FileAttachment) = AttachmentCard(
        AttachmentCardItem(name(item), item.mime, item.url),
        open = { openAttachment(item) },
    )

    private fun same(next: FileAttachment) = item.mime == next.mime && item.url == next.url && item.filename == next.filename

    companion object {
        fun openDefault(item: FileAttachment, openFile: (String) -> Unit, openUrl: (String) -> Unit) {
            val url = item.url.takeIf { it.isNotBlank() } ?: return
            val uri = runCatching { URI.create(url) }.getOrNull() ?: return
            if (uri.scheme == "file") {
                val path = runCatching { Path.of(uri).toString() }.getOrNull() ?: return
                openFile(path)
                return
            }
            openUrl(url)
        }
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
