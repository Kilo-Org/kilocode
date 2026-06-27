package ai.kilocode.client.settings.base

import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import com.intellij.icons.AllIcons
import com.intellij.openapi.util.text.StringUtil
import com.intellij.ui.components.JBTextField
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import javax.swing.JButton
import javax.swing.JPanel

internal class SettingsListEditor(
    private var items: List<String> = emptyList(),
    private val onChange: (List<String>) -> Unit,
) : Stack(StackAxis.VERTICAL, UiStyle.Gap.sm()) {
    private val field = JBTextField()
    private val rows = SettingsRows()

    init {
        val add = JButton("Add")
        add.addActionListener {
            val value = field.text.trim()
            if (value.isBlank()) return@addActionListener
            field.text = ""
            update(items + value)
            onChange(items)
        }
        next(JPanel(BorderLayout(UiStyle.Gap.sm(), 0)).apply {
            add(field, BorderLayout.CENTER)
            add(add, BorderLayout.EAST)
        })
        next(rows)
        sync()
    }

    @RequiresEdt
    fun update(next: List<String>) {
        items = next
        sync()
    }

    private fun sync() {
        items.forEachIndexed { idx, item ->
            val key = idx.toString()
            val value = JButton(AllIcons.Actions.Close).apply {
                border = JBUI.Borders.empty()
                addActionListener {
                    update(items.filterIndexed { i, _ -> i != idx })
                    onChange(items)
                }
            }
            if (rows.update(key, StringUtil.shortenTextWithEllipsis(item, 96, 0), value = value) == null) {
                rows.row(key, SettingsRow(StringUtil.shortenTextWithEllipsis(item, 96, 0), value = value))
            }
        }
        rows.retain(items.indices.map { it.toString() }.toSet())
    }
}
