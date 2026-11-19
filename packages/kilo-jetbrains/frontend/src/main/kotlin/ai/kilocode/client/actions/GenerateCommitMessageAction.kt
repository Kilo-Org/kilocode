package ai.kilocode.client.actions

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.KiloEditorRpcApi
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.EDT
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.project.Project
import com.intellij.openapi.vcs.ProjectLevelVcsManager
import com.intellij.openapi.vcs.VcsDataKeys
import com.intellij.openapi.vcs.CommitMessageI
import com.intellij.openapi.editor.Document
import com.intellij.openapi.util.io.FileUtil
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.Locale

class GenerateCommitMessageAction : DumbAwareAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.project != null && e.getData(VcsDataKeys.COMMIT_MESSAGE_CONTROL) != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val control = e.getData(VcsDataKeys.COMMIT_MESSAGE_CONTROL) ?: return
        val vcs = ProjectLevelVcsManager.getInstance(project)
        val files = e.getData(VcsDataKeys.SELECTED_CHANGES).orEmpty().flatMap { change ->
            listOfNotNull(change.beforeRevision?.file, change.afterRevision?.file)
        }.distinct()
        val roots = if (files.isEmpty()) vcs.allVcsRoots.toList() else files.map { vcs.getVcsRootObjectFor(it) }.distinct()
        val root = roots.singleOrNull()?.takeIf { it.vcs?.name == "Git" }?.path?.path
        if (root == null) {
            KiloNotifications.warning(project, KiloBundle.message("commit.generate.selectRepo"))
            return
        }
        val selected = files.map { FileUtil.getRelativePath(root, it.path, '/') ?: return }.distinct()
        project.service<CommitMessageGenerator>().generate(root, selected, control, e.getData(VcsDataKeys.COMMIT_MESSAGE_DOCUMENT))
    }
}

@Service(Service.Level.PROJECT)
internal class CommitMessageGenerator(private val project: Project, private val scope: CoroutineScope) {
    private val last = mutableMapOf<String, String>()
    private val pending = mutableSetOf<String>()

    fun generate(root: String, files: List<String>, control: CommitMessageI, document: Document?) {
        if (!pending.add(root)) return
        val stamp = document?.modificationStamp
        val previous = last[root]
        val language = Locale.getDefault(Locale.Category.DISPLAY).toLanguageTag()
        scope.launch(Dispatchers.EDT) {
            try {
                val result = withTimeoutOrNull(35_000) {
                    withContext(Dispatchers.IO) { KiloEditorRpcApi.getInstance().commitMessage(root, files, previous, language) }
                } ?: error(KiloBundle.message("commit.generate.timeout"))
                if (!project.isDisposed && document?.modificationStamp == stamp) {
                    control.setCommitMessage(result)
                    last[root] = result
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (!project.isDisposed) KiloNotifications.error(project, KiloBundle.message("commit.generate.failed"), e.localizedMessage)
            } finally {
                pending.remove(root)
            }
        }
    }
}
