package ai.kilocode.client.worktree

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.ide.ui.LafManagerListener
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.util.Disposer
import com.intellij.ui.ScrollingUtil
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import java.awt.BorderLayout
import java.awt.Cursor
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.ListSelectionModel
import javax.swing.SwingUtilities

/**
 * Simple git-worktree list. Mirrors the History stack: a [JBList] with a delete strip revealed on
 * selection, plus a create prompt driven from the tool-window action.
 */
class WorktreePanel(
    parent: Disposable,
    private val controller: WorktreeController,
) : BorderLayoutPanel(), Disposable {
    private val list = JBList(controller.model).apply {
        selectionMode = ListSelectionModel.SINGLE_SELECTION
        cellRenderer = WorktreeRenderer()
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        emptyText.text = KiloBundle.message("worktree.empty")
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                val row = locationToIndex(e.point)
                val box = row.takeIf { it >= 0 }?.let { getCellBounds(it, it) } ?: return
                if (!box.contains(e.point)) return
                if (e.clickCount == 1 && WorktreeRenderer.isDeleteClick(this@apply, box, e.point)) {
                    val item = model.getElementAt(row)
                    if (!item.main) confirm(item)
                }
            }
        })
        ScrollingUtil.installActions(this)
    }

    init {
        Disposer.register(parent, this)
        border = JBUI.Borders.empty()
        addToCenter(JBScrollPane(list).apply { border = JBUI.Borders.empty() })
        bindTheme()
    }

    val component: JComponent get() = this

    fun refresh() = controller.reload()

    fun requestCreate() {
        val name = Messages.showInputDialog(
            this,
            KiloBundle.message("worktree.create.prompt"),
            KiloBundle.message("worktree.create.title"),
            null,
        )?.trim().orEmpty()
        if (name.isNotEmpty()) controller.create(name, null)
    }

    private fun confirm(item: WorktreeDto) {
        val result = Messages.showYesNoDialog(
            this,
            KiloBundle.message("worktree.delete.confirm.message", item.name),
            KiloBundle.message("worktree.delete.confirm.title"),
            Messages.getWarningIcon(),
        )
        if (result != Messages.YES) return
        controller.remove(item)
    }

    private fun bindTheme() {
        val bus = ApplicationManager.getApplication().messageBus.connect(this)
        bus.subscribe(LafManagerListener.TOPIC, LafManagerListener {
            ApplicationManager.getApplication().invokeLater {
                SwingUtilities.updateComponentTreeUI(this)
            }
        })
    }

    override fun dispose() {}
}
