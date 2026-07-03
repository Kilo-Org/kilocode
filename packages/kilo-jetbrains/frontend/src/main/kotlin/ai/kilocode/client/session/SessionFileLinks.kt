package ai.kilocode.client.session

import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.ui.md.MdView
import ai.kilocode.rpc.isManagedWorktreeStorage
import ai.kilocode.rpc.dto.WorkspaceFileDto
import com.intellij.icons.AllIcons
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.openapi.ui.MessageType
import com.intellij.openapi.ui.popup.Balloon
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.ui.ColoredListCellRenderer
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.awt.RelativePoint
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.xml.util.XmlStringUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JList

typealias SessionFileOpener = (href: String, anchor: RelativePoint?) -> Unit

fun MdView.LinkEvent.anchor(): RelativePoint? {
    val component = component ?: return null
    val point = point ?: return null
    return RelativePoint(component, point)
}

fun openSessionLink(event: MdView.LinkEvent, openFile: SessionFileOpener, openUrl: (String) -> Unit) {
    if (SessionFileLinks.isFileHref(event.href)) {
        openFile(event.href, event.anchor())
        return
    }
    openUrl(event.href)
}

class SessionFileLinks(
    private val dir: String,
    private val service: KiloWorkspaceService,
    private val scope: CoroutineScope,
    private val root: JComponent,
    private val openUrl: (String) -> Unit,
    private val send: (String, Map<String, String>) -> Unit = Telemetry::send,
) {
    fun open(href: String, anchor: RelativePoint?) {
        if (!isFileHref(href)) {
            openUrl(href)
            return
        }
        val target = parse(href)
        scope.launch {
            val ok = service.openPath(dir, target.path, target.line, target.column)
            if (ok) {
                track(target, "direct")
                return@launch
            }
            val found = service.searchFiles(dir, decode(name(target.path)), FILE_SEARCH_LIMIT)
                .files
                .filterNot { it.directory }
                .filterNot { isManagedWorktreeStorage(it.path) }
                .ranked(target.path)
            when (val result = decide(false, found)) {
                Resolution.Opened -> Unit
                is Resolution.OpenDirect -> {
                    val opened = service.openPath(dir, result.file.path, target.line, target.column)
                    track(target, if (opened) "search_direct" else "missing")
                }
                is Resolution.Choose -> {
                    track(target, "chooser")
                    withContext(Dispatchers.Main) { choose(result.files, target, anchor) }
                }
                Resolution.Missing -> {
                    track(target, "missing")
                    withContext(Dispatchers.Main) { missing(target.path, anchor) }
                }
            }
        }
    }

    private fun track(target: Target, result: String) = send(
        "File Link Opened",
        mapOf(
            "surface" to "session",
            "kind" to "file",
            "hasLine" to (target.line != null).toString(),
            "hasColumn" to (target.column != null).toString(),
            "result" to result,
        ),
    )

    @RequiresEdt
    private fun choose(files: List<WorkspaceFileDto>, target: Target, anchor: RelativePoint?) {
        val popup = JBPopupFactory.getInstance()
            .createPopupChooserBuilder(files)
            .setRenderer(FileRenderer())
            .setItemChosenCallback { file ->
                scope.launch { service.openPath(dir, file.path, target.line, target.column) }
            }
            .createPopup()
        popup.show(anchor ?: RelativePoint.getCenterOf(root))
    }

    @RequiresEdt
    private fun missing(path: String, anchor: RelativePoint?) {
        JBPopupFactory.getInstance()
            .createHtmlTextBalloonBuilder(KiloBundle.message("session.file.missing", XmlStringUtil.escapeString(path)), MessageType.WARNING, null)
            .setAnimationCycle(0)
            .createBalloon()
            .also { it.setAnimationEnabled(false) }
            .show(anchor ?: RelativePoint.getCenterOf(root), Balloon.Position.above)
    }

    private class FileRenderer : ColoredListCellRenderer<WorkspaceFileDto>() {
        override fun customizeCellRenderer(
            list: JList<out WorkspaceFileDto>,
            value: WorkspaceFileDto?,
            index: Int,
            selected: Boolean,
            hasFocus: Boolean,
        ) {
            val file = value ?: return
            icon = icon(file)
            append(file.name)
            val parent = parent(file.path)
            if (parent.isNotBlank()) append("  $parent", SimpleTextAttributes.GRAYED_ATTRIBUTES)
        }
    }

    sealed interface Resolution {
        data object Opened : Resolution
        data class OpenDirect(val file: WorkspaceFileDto) : Resolution
        data class Choose(val files: List<WorkspaceFileDto>) : Resolution
        data object Missing : Resolution
    }

    data class Target(val path: String, val line: Int? = null, val column: Int? = null)

    companion object {
        private const val FILE_SEARCH_LIMIT = 50
        private val LINE = Regex(":(\\d+)(?:-\\d+)?(?::(\\d+))?$")
        private val SCHEME = Regex("^([A-Za-z][A-Za-z0-9+.-]*):")

        fun parse(href: String): Target {
            val match = LINE.find(href) ?: return Target(href)
            return Target(
                href.substring(0, match.range.first),
                match.groupValues[1].toIntOrNull(),
                match.groupValues.getOrNull(2)?.takeIf { it.isNotBlank() }?.toIntOrNull(),
            )
        }

        fun isFileHref(href: String): Boolean {
            val scheme = SCHEME.find(href)?.groupValues?.getOrNull(1) ?: return true
            if (scheme.length == 1) return true
            return scheme.equals("file", ignoreCase = true)
        }

        fun decide(openOk: Boolean, candidates: List<WorkspaceFileDto>): Resolution {
            if (openOk) return Resolution.Opened
            if (candidates.isEmpty()) return Resolution.Missing
            if (candidates.size == 1) return Resolution.OpenDirect(candidates.single())
            return Resolution.Choose(candidates)
        }

        private fun icon(file: WorkspaceFileDto): Icon = when {
            file.directory -> AllIcons.Nodes.Folder
            else -> FileTypeManager.getInstance().getFileTypeByFileName(file.name).icon ?: AllIcons.FileTypes.Text
        }

        private fun name(path: String): String {
            val clean = path.trimEnd('/', '\\')
            val idx = maxOf(clean.lastIndexOf('/'), clean.lastIndexOf('\\'))
            if (idx < 0) return clean
            return clean.substring(idx + 1)
        }

        private fun parent(path: String): String {
            val idx = path.lastIndexOf('/')
            if (idx <= 0) return ""
            return path.substring(0, idx)
        }

        private fun decode(value: String): String = runCatching {
            URLDecoder.decode(value.replace("+", "%2B"), StandardCharsets.UTF_8)
        }.getOrDefault(value)

        private fun List<WorkspaceFileDto>.ranked(path: String): List<WorkspaceFileDto> {
            val target = path.trimStart('/', '\\')
            return sortedByDescending { it.path == target || it.path.endsWith("/$target") }
        }
    }
}
