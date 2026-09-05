package ai.kilocode.client.settings

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.LogFileDto
import com.intellij.ide.actions.RevealFileAction
import com.intellij.notification.Notification
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.components.service
import com.intellij.openapi.fileChooser.FileChooserFactory
import com.intellij.openapi.fileChooser.FileSaverDescriptor
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.vfs.VirtualFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.nio.file.Files
import javax.swing.JComponent

/**
 * Diagnostic log actions for the Advanced settings page.
 *
 * In monolith mode the frontend and backend share one process, so a single reveal opens the log
 * in the OS file manager. In split mode the backend log lives on the remote host, so it is fetched
 * over RPC and saved through a client-side file dialog while the client log is revealed locally.
 */
internal object AdvancedLogActions {

    /** OS-appropriate reveal label (e.g. "Reveal in Finder", "Show in Explorer"). */
    fun revealLabel(): String = RevealFileAction.getActionName()

    fun reveal() {
        ApplicationManager.getApplication().executeOnPooledThread {
            val path = KiloLog.logFile()
            if (Files.exists(path)) RevealFileAction.openFile(path)
            else RevealFileAction.openDirectory(path.parent)
        }
    }

    fun downloadBackend(parent: JComponent) {
        val app = service<KiloAppService>()
        app.scope.launch {
            val log = app.backendLog()
            withContext(Dispatchers.EDT + ModalityState.any().asContextElement()) {
                save(parent, log)
            }
        }
    }

    private fun save(parent: JComponent, log: LogFileDto?) {
        if (log == null) {
            notify(NotificationType.WARNING, KiloBundle.message("settings.advanced.logs.backend.missing"))
            return
        }
        val descriptor = FileSaverDescriptor(
            KiloBundle.message("settings.advanced.logs.backend.save.title"),
            KiloBundle.message("settings.advanced.logs.backend.save.description"),
            "log",
        )
        val wrapper = FileChooserFactory.getInstance()
            .createSaveFileDialog(descriptor, parent)
            .save(null as VirtualFile?, log.name) ?: return
        ApplicationManager.getApplication().executeOnPooledThread {
            runCatching { wrapper.file.writeText(log.content, Charsets.UTF_8) }
                .onSuccess { notify(NotificationType.INFORMATION, KiloBundle.message("settings.advanced.logs.backend.saved", wrapper.file.name)) }
                .onFailure { notify(NotificationType.ERROR, KiloBundle.message("settings.advanced.logs.backend.failed"), it.message) }
        }
    }

    private fun notify(type: NotificationType, title: String, content: String? = null) {
        ApplicationManager.getApplication().invokeLater {
            val notification = NotificationGroupManager.getInstance()
                .getNotificationGroup("Kilo Code")
                ?.createNotification(title, content.orEmpty(), type)
                ?: Notification("Kilo Code", title, content.orEmpty(), type)
            notification.notify(ProjectManager.getInstance().openProjects.firstOrNull { !it.isDefault })
        }
    }
}
