package ai.kilocode.client.settings.base

import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.StackAxis
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.xml.util.XmlStringUtil
import java.awt.BorderLayout
import javax.swing.JComponent
import javax.swing.JPanel

class SettingsRow(
    title: String,
    description: String? = null,
    value: JComponent? = null,
) : JPanel(BorderLayout()) {

    private val titleLabel = JBLabel(title).apply { font = UiStyle.Fonts.bold() }
    private val descriptionLabel = JBLabel(descriptionHtml(description)).apply {
        font = UiStyle.Fonts.hint()
        foreground = UIUtil.getContextHelpForeground()
        setAllowAutoWrapping(true)
        isVisible = description != null
    }
    private val labels = Stack.vertical(UiStyle.Gap.sm())
    private val valuePanel = JPanel(BorderLayout())
    private var current: JComponent? = null

    init {
        border = JBUI.Borders.empty(UiStyle.Gap.pad(), 0, UiStyle.Gap.pad(), 0)
        valuePanel.isOpaque = false
        labels.next(titleLabel)
        labels.next(descriptionLabel)
        add(labels, BorderLayout.CENTER)
        add(valuePanel, BorderLayout.EAST)
        setValue(value)
    }

    fun update(
        title: String,
        description: String? = null,
        value: JComponent? = null,
    ) {
        if (titleLabel.text != title) titleLabel.text = title
        val text = descriptionHtml(description)
        if (descriptionLabel.text != text) descriptionLabel.text = text
        val visible = description != null
        if (descriptionLabel.isVisible != visible) descriptionLabel.isVisible = visible
        setValue(value)
    }

    private fun setValue(value: JComponent?) {
        if (current === value) return
        valuePanel.removeAll()
        current = value
        if (value != null) {
            valuePanel.add(value.align(HAlign.CENTER, VAlign.CENTER), BorderLayout.CENTER)
        }
        valuePanel.revalidate()
        valuePanel.repaint()
    }
}

private fun descriptionHtml(description: String?): String {
    val text = description ?: return ""
    return XmlStringUtil.wrapInHtml(XmlStringUtil.escapeString(text))
}

class SettingsRows : Stack(StackAxis.VERTICAL) {
    private val keyed = linkedMapOf<String, SettingsRow>()

    fun row(child: SettingsRow): SettingsRows {
        next(child)
        return this
    }

    fun row(key: String, child: SettingsRow): SettingsRow {
        keyed.remove(key)?.let { remove(it) }
        keyed[key] = child
        next(child)
        return child
    }

    fun update(
        key: String,
        title: String,
        description: String? = null,
        value: JComponent? = null,
    ): SettingsRow? {
        val row = keyed[key] ?: return null
        row.update(title, description, value)
        return row
    }

    fun remove(key: String): SettingsRow? {
        val row = keyed.remove(key) ?: return null
        remove(row)
        revalidate()
        repaint()
        return row
    }

    fun retain(keys: Set<String>) {
        keyed.keys.toList().filter { it !in keys }.forEach { remove(it) }
    }

    override fun removeAll() {
        keyed.clear()
        super.removeAll()
    }
}
