package ai.kilocode.client.session.context

import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.vfs.KiloVirtualFileSystem
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.EditorContextDto
import ai.kilocode.rpc.dto.PromptPartDto
import com.intellij.codeWithMe.ClientId
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.impl.EditorHistoryManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.SystemInfo
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.util.EnvironmentUtil
import java.nio.file.Path
import kotlin.io.path.name

/**
 * Reads the active/open editors and current selection at prompt-send time.
 *
 * Split mode caveat: the chat UI runs under a non-local [ClientId], so
 * [FileEditorManager.getOpenFiles]/[FileEditorManager.getSelectedTextEditor] take
 * the per-client branch and return nothing. The `*WithRemotes` variants read the
 * local composites directly and are the ones that actually see the user's tabs.
 * These APIs are `@ApiStatus.Experimental`.
 */
internal object EditorContextGatherer {
    private val LOG = KiloLog.create(EditorContextGatherer::class.java)

    // Resolved once per process; the login shell does not change during a session.
    private val shell: String? by lazy {
        if (SystemInfo.isWindows) EnvironmentUtil.getValue("COMSPEC") else EnvironmentUtil.getValue("SHELL")
    }

    data class Result(
        val context: EditorContextDto?,
        val selection: PromptPartDto?,
    )

    fun gather(project: Project, root: String): Result {
        if (!KiloPluginSettings.getAutoEditorContext()) {
            LOG.debug { "kind=editor-context enabled=false" }
            return Result(null, null)
        }
        val manager = FileEditorManager.getInstance(project)
        val base = Path.of(root).toAbsolutePath().normalize()
        val openFiles = manager.openFilesWithRemotes
        val editor = manager.selectedTextEditorWithRemotes.firstOrNull()
        val activeFile = editor?.let { file(it) } ?: lastOpen(project, openFiles) ?: openFiles.firstOrNull()
        val ignore = project.service<KiloIgnoreCache>().matcher(rootDir(listOfNotNull(activeFile) + openFiles, base))

        fun keep(file: VirtualFile?): String? = rel(file, base)?.takeUnless { ignore.ignored(it) }

        val active = keep(activeFile)
        val openRel = openFiles.mapNotNull { rel(it, base) }.distinct()
        val open = openRel.filterNot { ignore.ignored(it) }.take(20)
        val visible = (listOfNotNull(activeFile) + manager.selectedTextEditorWithRemotes.mapNotNull { file(it) })
            .mapNotNull { keep(it) }
            .distinct()
            .take(200)
        val ctx = EditorContextDto(
            activeFile = active,
            openTabs = open.takeIf { it.isNotEmpty() },
            visibleFiles = visible.takeIf { it.isNotEmpty() },
            shell = shell,
        ).takeIf { active != null || open.isNotEmpty() || visible.isNotEmpty() || shell != null }
        val part = editor?.let { selection(it, base, ignore) }
        LOG.debug {
            val first = openFiles.firstOrNull()
            val filtered = openRel.count { ignore.ignored(it) }
            "kind=editor-context enabled=true localId=${ClientId.isCurrentlyUnderLocalId}" +
                " rawOpen=${openFiles.size} rawSel=${manager.selectedTextEditorWithRemotes.size}" +
                " active=${active ?: "none"} open=${open.size} visible=${visible.size} selection=${part != null}" +
                " ignored=$filtered shell=${shell ?: "none"}" +
                " firstFs=${first?.fileSystem?.protocol ?: "none"} firstLocal=${first?.isInLocalFileSystem ?: false}" +
                " firstPath=${first?.path ?: "none"}"
        }
        return Result(ctx, part)
    }

    private fun lastOpen(project: Project, open: List<VirtualFile>): VirtualFile? {
        val set = open.toHashSet()
        return EditorHistoryManager.getInstance(project).fileList.lastOrNull { it in set }
    }

    // Walks up from an open editor file to the workspace-root directory so ignore
    // files can be read via the same (possibly remote) VFS as the editor files.
    private fun rootDir(files: List<VirtualFile>, root: Path): VirtualFile? {
        for (file in files) {
            var cur: VirtualFile? = file
            while (cur != null) {
                if (runCatching { Path.of(cur.path).toAbsolutePath().normalize() }.getOrNull() == root) return cur
                cur = cur.parent
            }
        }
        return null
    }

    private fun selection(editor: Editor, root: Path, ignore: KiloIgnore): PromptPartDto? {
        val model = editor.selectionModel
        if (!model.hasSelection()) return null
        val file = file(editor) ?: return null
        val path = local(file, root) ?: return null
        if (ignore.ignored(root.relativize(path).toString())) return null
        val start = model.selectionStart
        val end = model.selectionEnd
        if (start == end) return null
        val doc = editor.document
        val last = (end - 1).coerceAtLeast(start)
        val first = doc.getLineNumber(start) + 1
        val line = doc.getLineNumber(last) + 1
        val url = "${path.toUri()}?start=$first&end=$line"
        return PromptPartDto(
            type = "file",
            mime = "text/plain",
            url = url,
            filename = path.name,
        )
    }

    private fun file(editor: Editor): VirtualFile? = FileDocumentManager.getInstance().getFile(editor.document)

    private fun rel(file: VirtualFile?, root: Path): String? {
        val path = file?.let { local(it, root) } ?: return null
        return root.relativize(path).toString()
    }

    private fun local(file: VirtualFile, root: Path): Path? {
        if (file.fileSystem.protocol == KiloVirtualFileSystem.PROTOCOL) return null
        // A host filename that is invalid on the client OS (e.g. `?`/`*` from a Linux host on
        // a Windows frontend) throws InvalidPathException; drop the file instead of failing the send.
        val path = runCatching { Path.of(file.path).toAbsolutePath().normalize() }.getOrNull() ?: return null
        if (!path.startsWith(root)) return null
        return path
    }
}
