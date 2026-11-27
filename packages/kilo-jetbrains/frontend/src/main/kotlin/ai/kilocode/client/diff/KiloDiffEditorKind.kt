package ai.kilocode.client.diff

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloSessionService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.telemetry.Telemetry
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.vfs.KiloEditorKind
import ai.kilocode.client.vfs.KiloEditorKindRegistry
import ai.kilocode.client.vfs.KiloVfsManager
import ai.kilocode.client.vfs.KiloVirtualFile
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.DiffFileDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.io.FileUtil
import com.intellij.ui.AnimatedIcon
import com.intellij.ui.components.ActionLink
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.Centerizer
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.awt.BorderLayout
import java.util.concurrent.atomic.AtomicBoolean
import javax.swing.JComponent
import javax.swing.JPanel

internal object KiloDiffEditorKind : KiloEditorKind {
    const val ID = "kilo-diff"

    override val id: String = ID

    override fun title(params: Map<String, String>): String {
        params["title"].takeIfPresent()?.let { return it }
        val comparison = KiloDiffComparison.entries.firstOrNull { it.source == params["source"] }
        return comparison?.title(params["branch"].takeIfPresent())
            ?: params["branch"].takeIfPresent()?.let { KiloBundle.message("diff.editor.branch.title.named", it) }
            ?: KiloBundle.message("diff.editor.session.title")
    }

    override fun presentablePath(params: Map<String, String>): String = title(params)

    override fun isValid(params: Map<String, String>): Boolean {
        val dir = params["directory"].takeIfPresent() ?: return false
        if (dir.isBlank()) return false
        if (params["source"] == "branch" || params["source"] == "local") return true
        if (params["source"] == "inline") return params["token"].takeIfPresent() != null
        return params["sessionId"].takeIfPresent() != null
    }

    @RequiresEdt
    override fun createContent(project: Project, file: KiloVirtualFile, parent: Disposable): JComponent {
        val panel = JPanel(BorderLayout())
        panel.add(connecting(), BorderLayout.CENTER)
        val service = project.service<KiloDiffEditorService>()
        var current: Disposable? = null
        fun render(data: DiffEditorData) {
            current?.let { Disposer.dispose(it) }
            val child = Disposer.newDisposable(parent, "Kilo diff editor content")
            current = child
            panel.removeAll()
            panel.add(
                when (data) {
                    DiffEditorData.Connecting -> connecting()
                    DiffEditorData.Empty -> emptyChangesComponent()
                    is DiffEditorData.Error -> failed(data.message)
                    is DiffEditorData.Files -> buildDiffEditor(
                        project,
                        file.path.params,
                        data.files,
                        child,
                        data.branch,
                        service.scope,
                        { done -> service.refresh(file.path.params, done) },
                        ::render,
                    )
                },
                BorderLayout.CENTER,
            )
            panel.revalidate()
            panel.repaint()
        }
        service.load(file.path.params, parent, ::render)
        return panel
    }
}

@Service(Service.Level.PROJECT)
internal class KiloDiffEditorService(
    private val project: Project,
    private val cs: CoroutineScope,
) {
    internal val scope: CoroutineScope
        get() = cs

    @RequiresEdt
    fun open(directory: String, comparison: KiloDiffComparison, branch: String?, parent: Disposable) {
        if (project.isDisposed || Disposer.isDisposed(parent) || !cs.isActive) return
        val dir = FileUtil.toCanonicalPath(FileUtil.toSystemIndependentName(directory), '/', true)
            .takeIfPresent() ?: return
        val name = branch.takeIfPresent()
        if (name != null) {
            show(dir, comparison, name)
            return
        }
        val job = cs.launch {
            val branch = service<KiloWorkspaceService>().branchName(dir)
            withContext(Dispatchers.Main) {
                if (!project.isDisposed && !Disposer.isDisposed(parent)) show(dir, comparison, branch)
            }
        }
        val guard = Disposable { job.cancel() }
        Disposer.register(parent, guard)
        job.invokeOnCompletion { Disposer.dispose(guard) }
    }

    @RequiresEdt
    private fun show(dir: String, comparison: KiloDiffComparison, branch: String?) {
        ensureDiffEditorKind()
        val opened = project.service<KiloVfsManager>().open(
            KiloDiffEditorKind.ID,
            diffParams(comparison.source, dir, null, comparison.title(branch), branch),
        )
        if (opened) Telemetry.send("Diff Editor Opened", mapOf("source" to comparison.source))
    }

    fun load(params: Map<String, String>, parent: Disposable, done: (DiffEditorData) -> Unit) {
        val disposed = AtomicBoolean(false)
        val job = cs.launch {
            val app = service<KiloAppService>()
            app.connect()
            withContext(Dispatchers.Main) {
                if (alive(disposed)) done(DiffEditorData.Connecting)
            }
            val state = app.state.first { it.status == KiloAppStatusDto.READY || it.status == KiloAppStatusDto.ERROR }
            if (state.status == KiloAppStatusDto.ERROR) {
                withContext(Dispatchers.Main) {
                    if (alive(disposed)) done(DiffEditorData.Error(KiloBundle.message("session.connection.error.app")))
                }
                return@launch
            }
            val data = runCatching { fetch(params) }
                .getOrElse {
                    if (it is CancellationException) throw it
                    LOG.warn("diff editor load failed source=${params["source"]} dir=${params["directory"]}", it)
                    DiffEditorData.Error(it.message ?: it::class.java.simpleName)
                }
            withContext(Dispatchers.Main) {
                if (alive(disposed)) done(data)
            }
        }
        Disposer.register(parent) {
            disposed.set(true)
            job.cancel()
        }
    }

    fun refresh(params: Map<String, String>, done: (DiffEditorData) -> Unit) = cs.launch {
        val data = runCatching { fetch(params) }
            .getOrElse {
                if (it is CancellationException) throw it
                LOG.warn("diff editor refresh failed source=${params["source"]} dir=${params["directory"]}", it)
                DiffEditorData.Error(it.message ?: it::class.java.simpleName)
            }
        withContext(Dispatchers.Main) {
            if (!project.isDisposed) done(data)
        }
    }

    private fun alive(disposed: AtomicBoolean): Boolean = !project.isDisposed && !disposed.get()

    internal suspend fun fetch(params: Map<String, String>): DiffEditorData {
        val dir = params["directory"].takeIfPresent() ?: return DiffEditorData.Empty
        val workspace = service<KiloWorkspaceService>()
        val store = project.service<KiloInlineDiffStore>()
        val session = project.service<KiloSessionService>()
        val files = when (params["source"]) {
            "branch" -> workspace.branchDiff(dir)
            "local" -> workspace.localDiff(dir)
            "inline" -> {
                val token = params["token"].orEmpty()
                val cached = store.get(token).orEmpty()
                val id = params["sessionId"].takeIfPresent()
                // A tool or a revert is narrower than a turn. Keep its own patch even when the
                // same file changed several times in that turn. Only turns have a snapshot range.
                val message = id?.let { token.removePrefix("turn:$it:").takeIf { name -> name != token && name.isNotBlank() } }
                if (id == null || message == null) cached else try {
                    session.diff(id, dir, message, full = true)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (cached.isEmpty()) throw e
                    cached
                }
            }
            else -> session.diff(params["sessionId"].orEmpty(), dir, full = true)
        }
        if (files.isEmpty()) return DiffEditorData.Empty
        val branch = params["branch"].takeIfPresent()
            ?: if (params["source"] == "branch" || params["source"] == "local") workspace.branchName(dir) else null
        return DiffEditorData.Files(files, branch)
    }

    private companion object {
        private val LOG = KiloLog.create(KiloDiffEditorService::class.java)
    }
}

internal sealed interface DiffEditorData {
    data object Connecting : DiffEditorData
    data object Empty : DiffEditorData
    data class Error(val message: String) : DiffEditorData
    data class Files(val files: List<DiffFileDto>, val branch: String? = null) : DiffEditorData
}

internal fun diffParams(source: String, directory: String, sessionId: String?, title: String, branch: String? = null, token: String? = null): Map<String, String> =
    linkedMapOf(
        "source" to source,
        "directory" to directory,
        "title" to title,
    ).apply {
        if (!sessionId.isNullOrBlank()) put("sessionId", sessionId)
        if (!branch.isNullOrBlank()) put("branch", branch)
        if (!token.isNullOrBlank()) put("token", token)
    }

fun ensureDiffEditorKind() {
    service<KiloEditorKindRegistry>().register(KiloDiffEditorKind)
}

enum class KiloDiffComparison(internal val source: String, private val title: String, private val named: String) {
    BASE("branch", "diff.editor.branch.title", "diff.editor.branch.title.named"),
    LOCAL("local", "diff.editor.local.title", "diff.editor.local.title.named"),
    ;

    internal fun title(branch: String?): String =
        branch.takeIfPresent()?.let { KiloBundle.message(named, it) } ?: KiloBundle.message(title)
}

@RequiresEdt
fun openKiloDiff(
    project: Project,
    directory: String,
    comparison: KiloDiffComparison,
    branch: String? = null,
    parent: Disposable = project,
) {
    if (project.isDisposed || Disposer.isDisposed(parent)) return
    project.service<KiloDiffEditorService>().open(directory, comparison, branch, parent)
}

private fun connecting(): JComponent = Stack.horizontal(gap = UiStyle.Gap.sm()).apply {
    border = JBUI.Borders.empty(UiStyle.Gap.pad())
    next(JBLabel(AnimatedIcon.Default()))
    next(JBLabel(KiloBundle.message("session.connection.connecting")))
}.let { Centerizer(it, Centerizer.TYPE.BOTH) }

private fun failed(message: String): JComponent = Stack.horizontal(gap = UiStyle.Gap.sm()).apply {
    border = JBUI.Borders.empty(UiStyle.Gap.pad())
    next(JBLabel(message))
    next(ActionLink(KiloBundle.message("session.connection.retry")) {
        service<KiloAppService>().retryAsync()
    })
}.let { Centerizer(it, Centerizer.TYPE.BOTH) }

private fun String?.takeIfPresent(): String? = takeIf { !it.isNullOrBlank() }
