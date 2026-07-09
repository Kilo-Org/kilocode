package ai.kilocode.client.session.ui.attachment

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.FileAttachment
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.vfs.KiloEditorKind
import ai.kilocode.client.vfs.KiloEditorKindRegistry
import ai.kilocode.client.vfs.KiloVirtualFile
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.KiloAppStatusDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.components.ActionLink
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.Centerizer
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.image.BufferedImage
import java.io.ByteArrayInputStream
import java.security.MessageDigest
import javax.imageio.ImageIO
import javax.swing.Icon
import javax.swing.ImageIcon
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.SwingConstants
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal object AttachmentEditorKind : KiloEditorKind {
    const val ID = "attachment"

    override val id: String = ID

    override fun title(params: Map<String, String>): String = ref(params)?.filename ?: KiloBundle.message("session.attachment.title")
    override fun icon(params: Map<String, String>): Icon? = attachmentIcon(params["mime"].orEmpty(), title(params))
    override fun presentablePath(params: Map<String, String>): String {
        val ref = ref(params)
        return KiloBundle.message("session.attachment.path", ref?.sessionId.orEmpty(), ref?.filename ?: title(params))
    }

    override fun isValid(params: Map<String, String>): Boolean = ref(params) != null

    @RequiresEdt
    override fun createContent(project: Project, file: KiloVirtualFile, parent: Disposable): JComponent {
        val panel = JPanel(BorderLayout()).apply {
            border = JBUI.Borders.empty(UiStyle.Gap.pad())
        }
        panel.add(component(AttachmentData.Connecting), BorderLayout.CENTER)
        val ref = ref(file.path.params)
        LOG.info("kind=attachment-editor phase=create-content valid=${ref != null} project=${project.name} hash=${project.locationHash} ref=${ref?.let(::brief) ?: "invalid"}")
        if (ref == null) {
            panel.removeAll()
            panel.add(component(AttachmentData.Missing), BorderLayout.CENTER)
            return panel
        }
        project.service<KiloAttachmentEditorService>().load(ref, parent) { data ->
            LOG.info("kind=attachment-editor phase=render data=${describe(data)} ref=${brief(ref)}")
            panel.removeAll()
            panel.add(component(data), BorderLayout.CENTER)
            panel.revalidate()
            panel.repaint()
        }
        return panel
    }

    private fun ref(params: Map<String, String>): AttachmentRef? {
        val session = params["sessionId"].takeIfPresent() ?: return null
        val message = params["messageId"].takeIfPresent() ?: return null
        val part = params["partId"].takeIfPresent() ?: return null
        val dir = params["directory"].takeIfPresent() ?: return null
        return AttachmentRef(
            directory = dir,
            sessionId = session,
            messageId = message,
            partId = part,
            attachmentKey = params["attachmentKey"].takeIfPresent(),
            filename = params["filename"].takeIfPresent() ?: part,
            mime = params["mime"].orEmpty(),
        )
    }

    private val LOG = KiloLog.create(AttachmentEditorKind::class.java)
}

private fun component(data: AttachmentData): JComponent = when (data) {
    is AttachmentData.Text -> text(data.text)
    is AttachmentData.Image -> JBScrollPane(JBLabel(ImageIcon(data.image), SwingConstants.CENTER))
    is AttachmentData.Binary -> metadata(data.name, data.mime, data.size)
    is AttachmentData.Missing -> center(KiloBundle.message("session.attachment.missing"))
    is AttachmentData.Error -> center(KiloBundle.message("session.attachment.error", data.message))
    AttachmentData.Connecting -> connecting()
    AttachmentData.ConnectionFailed -> failed()
}

private fun connecting(): JComponent {
    return Stack.horizontal(gap = UiStyle.Gap.sm()).apply {
        border = JBUI.Borders.empty(UiStyle.Gap.pad())
        next(JBLabel(AnimatedIcon.Default()))
        next(JBLabel(KiloBundle.message("session.connection.connecting")))
    }.let { Centerizer(it, Centerizer.TYPE.BOTH) }
}

private fun failed(): JComponent {
    return Stack.horizontal(gap = UiStyle.Gap.sm()).apply {
        border = JBUI.Borders.empty(UiStyle.Gap.pad())
        next(JBLabel(KiloBundle.message("session.connection.error.app")))
        next(ActionLink(KiloBundle.message("session.connection.retry")) {
            service<KiloAppService>().retryAsync()
        })
    }.let { Centerizer(it, Centerizer.TYPE.BOTH) }
}

private fun text(value: String): JComponent {
    val area = JBTextArea(value).apply {
        isEditable = false
        lineWrap = false
        border = JBUI.Borders.empty(UiStyle.Gap.sm())
    }
    return JBScrollPane(area)
}

private fun metadata(name: String, mime: String, size: Int): JComponent {
    return Stack.vertical(gap = UiStyle.Gap.sm()).apply {
        border = JBUI.Borders.empty(UiStyle.Gap.pad())
        next(JBLabel(KiloBundle.message("session.attachment.unsupported", name)))
        next(JBLabel(KiloBundle.message("session.attachment.mime", mime.ifBlank { "unknown" })))
        next(JBLabel(KiloBundle.message("session.attachment.size", size)))
    }
}

private fun center(value: String): JComponent = Centerizer(JBLabel(value), Centerizer.TYPE.BOTH)

@Service(Service.Level.PROJECT)
internal class KiloAttachmentEditorService(
    private val project: Project,
    private val cs: CoroutineScope,
) {
    companion object {
        private val LOG = KiloLog.create(KiloAttachmentEditorService::class.java)
    }

    fun load(ref: AttachmentRef, parent: Disposable, done: (AttachmentData) -> Unit) {
        LOG.info("kind=attachment-load phase=start project=${project.name} hash=${project.locationHash} ref=${brief(ref)}")
        val disposed = AtomicBoolean(false)
        val job = cs.launch {
            val app = service<KiloAppService>()
            app.connect()
            while (!disposed.get()) {
                withContext(Dispatchers.Main) {
                    if (alive(disposed)) {
                        LOG.info("kind=attachment-load phase=connecting ref=${brief(ref)}")
                        done(AttachmentData.Connecting)
                    }
                }
                val state = app.state.first { it.status == KiloAppStatusDto.READY || it.status == KiloAppStatusDto.ERROR }
                LOG.info("kind=attachment-load phase=app-state status=${state.status} ref=${brief(ref)}")
                if (state.status == KiloAppStatusDto.ERROR) {
                    withContext(Dispatchers.Main) {
                        if (alive(disposed)) {
                            LOG.info("kind=attachment-load phase=connection-failed ref=${brief(ref)}")
                            done(AttachmentData.ConnectionFailed)
                        }
                    }
                    app.state.first { it.status != KiloAppStatusDto.ERROR }
                    continue
                }
                val data = runCatching { fetch(ref) }
                    .getOrElse {
                        LOG.warn("kind=attachment-load phase=fetch-error ref=${brief(ref)} message=${it.message}", it)
                        AttachmentData.Error(it.message ?: it::class.java.simpleName)
                    }
                withContext(Dispatchers.Main) {
                    if (alive(disposed)) {
                        LOG.info("kind=attachment-load phase=done data=${describe(data)} ref=${brief(ref)}")
                        done(data)
                    }
                }
                return@launch
            }
        }
        Disposer.register(parent) {
            disposed.set(true)
            LOG.info("kind=attachment-load phase=dispose ref=${brief(ref)}")
            job.cancel()
        }
    }

    private fun alive(disposed: AtomicBoolean): Boolean = !project.isDisposed && !disposed.get()

    private suspend fun fetch(ref: AttachmentRef): AttachmentData {
        val item = project.service<KiloSessionService>().attachmentPart(
            ref.sessionId,
            ref.directory,
            ref.messageId,
            ref.partId,
            ref.attachmentKey,
        ) ?: run {
            LOG.info("kind=attachment-fetch result=missing reason=part-not-found session=${ref.sessionId} message=${ref.messageId} part=${ref.partId} key=${ref.attachmentKey ?: "none"}")
            return AttachmentData.Missing
        }
        val mode = if (ref.attachmentKey.isPresent()) "attachmentKey" else "partId"
        LOG.info("kind=attachment-fetch phase=matched mode=$mode session=${ref.sessionId} message=${ref.messageId} part=${item.id} name=${item.filename.orEmpty()} mime=${item.mime.orEmpty()} url=${urlInfo(item.url.orEmpty())}")
        val data = parseDataUrl(item.url.orEmpty()) ?: run {
            LOG.info("kind=attachment-fetch result=missing reason=parse-data-url session=${ref.sessionId} message=${ref.messageId} part=${item.id} url=${urlInfo(item.url.orEmpty())}")
            return AttachmentData.Missing
        }
        val mime = item.mime?.takeIf { it.isNotBlank() } ?: data.mime
        val name = item.filename?.takeIf { it.isNotBlank() } ?: ref.filename
        LOG.info("kind=attachment-fetch phase=parsed session=${ref.sessionId} message=${ref.messageId} part=${item.id} name=$name dtoMime=${item.mime.orEmpty()} dataMime=${data.mime} mime=$mime bytes=${data.bytes.size}")
        if (textual(mime)) return AttachmentData.Text(data.bytes.toString(Charsets.UTF_8))
        if (mime.startsWith("image/")) {
            return withContext(Dispatchers.IO) {
                val image = ImageIO.read(ByteArrayInputStream(data.bytes)) ?: return@withContext AttachmentData.Binary(name, mime, data.bytes.size)
                LOG.info("kind=attachment-fetch phase=image session=${ref.sessionId} message=${ref.messageId} part=${item.id} width=${image.width} height=${image.height} bytes=${data.bytes.size}")
                AttachmentData.Image(image)
            }
        }
        return AttachmentData.Binary(name, mime, data.bytes.size)
    }
}

internal data class AttachmentRef(
    val directory: String,
    val sessionId: String,
    val messageId: String,
    val partId: String,
    val attachmentKey: String?,
    val filename: String,
    val mime: String,
)

fun ensureAttachmentEditorKind() {
    service<KiloEditorKindRegistry>().register(AttachmentEditorKind)
}

internal fun unregisterAttachmentEditorKind() {
    service<KiloEditorKindRegistry>().unregister(AttachmentEditorKind.ID)
}

internal fun attachmentParams(
    sessionId: String,
    messageId: String,
    item: FileAttachment,
    filename: String,
    directory: String,
): Map<String, String> = linkedMapOf(
    "directory" to directory,
    "sessionId" to sessionId,
    "messageId" to messageId,
    "partId" to item.id,
    "attachmentKey" to attachmentKey(item.id, item.filename.orEmpty(), item.url),
    "filename" to filename,
    "mime" to item.mime,
)

internal sealed interface AttachmentData {
    data class Text(val text: String) : AttachmentData
    data class Image(val image: BufferedImage) : AttachmentData
    data class Binary(val name: String, val mime: String, val size: Int) : AttachmentData
    data object Missing : AttachmentData
    data class Error(val message: String) : AttachmentData
    data object Connecting : AttachmentData
    data object ConnectionFailed : AttachmentData
}

private fun brief(ref: AttachmentRef): String {
    return listOf(
        "sessionId=${ref.sessionId}",
        "messageId=${ref.messageId}",
        "partId=${ref.partId}",
        "attachmentKey=${ref.attachmentKey ?: ""}",
        "filename=${ref.filename}",
        "mime=${ref.mime}",
        "directory=${ref.directory}",
    ).joinToString(prefix = "{", postfix = "}")
}

private fun String?.isPresent(): Boolean = !this.isNullOrBlank()
private fun String?.takeIfPresent(): String? = takeIf { !it.isNullOrBlank() }

private fun describe(data: AttachmentData): String = when (data) {
    is AttachmentData.Text -> "text chars=${data.text.length}"
    is AttachmentData.Image -> "image width=${data.image.width} height=${data.image.height}"
    is AttachmentData.Binary -> "binary name=${data.name} mime=${data.mime} bytes=${data.size}"
    is AttachmentData.Error -> "error message=${data.message}"
    AttachmentData.Missing -> "missing"
    AttachmentData.Connecting -> "connecting"
    AttachmentData.ConnectionFailed -> "connection-failed"
}

private fun urlInfo(url: String): String {
    val scheme = url.substringBefore(':', missingDelimiterValue = "none")
    return "urlScheme=$scheme urlChars=${url.length} embedded=${isEmbeddedAttachment(url)}"
}

private fun attachmentKey(part: String, name: String, url: String): String {
    val value = listOf(part, name, url).joinToString("\u0000")
    val bytes = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
    return bytes.take(16).joinToString("") { "%02x".format(it) }
}
