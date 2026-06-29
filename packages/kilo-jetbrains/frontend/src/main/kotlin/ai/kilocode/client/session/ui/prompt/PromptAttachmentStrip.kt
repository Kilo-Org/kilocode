package ai.kilocode.client.session.ui.prompt

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.PromptAttachment
import ai.kilocode.client.session.ui.attachment.AttachmentCard
import ai.kilocode.client.session.ui.attachment.AttachmentCardItem
import ai.kilocode.client.ui.UiStyle
import com.intellij.notification.Notification
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.FlowLayout
import javax.swing.JPanel

class PromptAttachmentStrip(
    private val project: Project,
    private val removed: (PromptAttachment) -> Unit,
) : JPanel(FlowLayout(FlowLayout.LEFT, UiStyle.Gap.sm(), UiStyle.Gap.sm())) {
    private val chips = LinkedHashMap<String, PromptAttachmentChip>()

    init {
        border = JBUI.Borders.emptyBottom(UiStyle.Gap.sm())
        isVisible = false
    }

    val count: Int get() = chips.size

    @RequiresEdt
    fun add(item: PromptAttachment) {
        if (chips.containsKey(item.id)) return
        val chip = PromptAttachmentChip(project, item, remove = { removed(item) })
        chips[item.id] = chip
        add(chip)
        sync()
    }

    @RequiresEdt
    fun remove(item: PromptAttachment) {
        val chip = chips.remove(item.id) ?: return
        remove(chip)
        sync()
    }

    @RequiresEdt
    fun clear() {
        if (chips.isEmpty()) return
        chips.clear()
        removeAll()
        sync()
    }

    @RequiresEdt
    private fun sync() {
        isVisible = chips.isNotEmpty()
        revalidate()
        repaint()
    }
}

private class PromptAttachmentChip(
    project: Project,
    item: PromptAttachment,
    remove: () -> Unit,
) : AttachmentCard(
    AttachmentCardItem(item.name, item.mime, item.url, item.path),
    remove = remove,
    open = { open(project, item) },
) {
    companion object {
        private fun open(project: Project, item: PromptAttachment) {
            val path = item.path ?: return
            ApplicationManager.getApplication().executeOnPooledThread {
                val file = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(path)
                ApplicationManager.getApplication().invokeLater {
                    if (project.isDisposed) return@invokeLater
                    if (file == null) {
                        Notification("Kilo Code", KiloBundle.message("prompt.attachment.missing", item.name), NotificationType.WARNING).notify(project)
                        return@invokeLater
                    }
                    FileEditorManager.getInstance(project).openFile(file, true)
                }
            }
        }
    }
}
