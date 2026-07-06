package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Message
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.icons.AllIcons
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import javax.swing.JButton
import javax.swing.JPanel

internal class RevertBanner(
    private val revert: (String) -> Unit,
    private val unrevert: () -> Unit,
) : JPanel(BorderLayout()) {
    private val title = JBLabel(AllIcons.Actions.Rollback)
    private val files = Stack.vertical(UiStyle.Gap.xs())
    private val hint = JBLabel(KiloBundle.message("revert.banner.hint")).apply {
        foreground = UiStyle.Colors.weak()
    }
    private val redo = JButton(KiloBundle.message("revert.banner.redo")).apply {
        addActionListener { next?.let(revert) ?: unrevert() }
    }
    private val all = JButton(KiloBundle.message("revert.banner.redo.all")).apply {
        addActionListener { unrevert() }
    }
    private var next: String? = null

    init {
        isOpaque = false
        border = JBUI.Borders.empty(UiStyle.Gap.sm(), UiStyle.Gap.md(), UiStyle.Gap.sm(), UiStyle.Gap.md())
        val actions = Stack.horizontal(UiStyle.Gap.sm()).next(redo).next(all)
        val top = JPanel(BorderLayout()).apply {
            isOpaque = false
            add(title, BorderLayout.WEST)
            add(actions, BorderLayout.EAST)
        }
        add(Stack.vertical(UiStyle.Gap.sm()).next(top).next(files).next(hint), BorderLayout.CENTER)
        isVisible = false
    }

    @RequiresEdt
    fun update(messages: Collection<Message>, boundary: String?, diff: List<DiffFileDto>) {
        if (boundary == null) {
            isVisible = false
            return
        }
        val users = messages.filter { it.info.role == "user" }
        val index = users.indexOfFirst { it.info.id == boundary }
        val count = if (index < 0) 0 else users.size - index
        if (count <= 0) {
            isVisible = false
            return
        }
        isVisible = true
        next = users.drop(index + 1).firstOrNull()?.info?.id
        all.isVisible = count > 1
        title.text = if (count == 1) {
            KiloBundle.message("revert.banner.count.one", count)
        } else {
            KiloBundle.message("revert.banner.count.other", count)
        }
        files.removeAll()
        for (file in diff) {
            files.next(JBLabel("${file.file}  +${file.additions} -${file.deletions}"))
        }
        files.isVisible = diff.isNotEmpty()
        revalidate()
        repaint()
    }
}
