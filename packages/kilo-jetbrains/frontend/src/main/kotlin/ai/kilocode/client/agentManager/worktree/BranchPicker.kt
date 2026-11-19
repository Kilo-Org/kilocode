package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.session.ui.prompt.PromptFuzzyRanker
import com.intellij.openapi.ui.ComboBox
import com.intellij.ui.DocumentAdapter
import java.awt.Dimension
import java.awt.event.FocusAdapter
import java.awt.event.FocusEvent
import javax.swing.ComboBoxModel
import javax.swing.DefaultComboBoxModel
import javax.swing.JTextField
import javax.swing.event.DocumentEvent
import javax.swing.plaf.basic.BasicComboBoxUI
import javax.swing.plaf.basic.BasicComboPopup

internal class BranchPicker(branches: List<String>, private val default: String = "") :
    ComboBox<String>(model(branches, default)) {
    private val branches = ordered(branches, default)
    private val set = this.branches.toSet()
    private var syncing = false

    val empty: Boolean get() = branches.isEmpty()

    init {
        isEditable = true
        if (default.isNotBlank()) selectedItem = default
        wire()
    }

    override fun getPreferredSize(): Dimension {
        ensureEditor()
        return super.getPreferredSize()
    }

    fun resolve(): String? {
        val value = text()
        if (value.isEmpty()) {
            val fallback = default.trim()
            if (fallback.isNotEmpty()) set(fallback)
            return fallback.takeIf { it.isNotEmpty() }
        }
        if (value in set) return value
        val idx = match(value) ?: return value
        val target = branches[idx]
        set(target)
        return target
    }

    fun known(value: String?): Boolean = value == null || value in set

    fun focusText() {
        field()?.apply {
            requestFocusInWindow()
            selectAll()
        }
    }

    private fun wire() {
        val field = field() ?: return
        field.document.addDocumentListener(object : DocumentAdapter() {
            override fun textChanged(e: DocumentEvent) {
                if (!syncing) sync(field.text, popup = true)
            }
        })
        field.addFocusListener(object : FocusAdapter() {
            override fun focusLost(e: FocusEvent) {
                restore()
            }
        })
    }

    private fun restore() {
        if (default.isBlank() || text().isNotEmpty()) return
        set(default)
    }

    private fun sync(text: String, popup: Boolean) {
        val value = text.trim()
        if (value.isEmpty()) return
        if (popup && isShowing && !isPopupVisible) isPopupVisible = true
        val idx = match(value) ?: return
        val list = popupList() ?: return
        if (list.selectedIndex != idx) list.selectedIndex = idx
        list.ensureIndexIsVisible(idx)
    }

    private fun match(text: String): Int? {
        val rank = PromptFuzzyRanker(text)
        return branches.withIndex().mapNotNull { item ->
            rank.score(item.value, emptyList())?.let { score -> item.index to score }
        }.maxByOrNull { it.second }?.first
    }

    private fun popupList() = (getAccessibleContext()?.getAccessibleChild(0) as? BasicComboPopup)?.list

    private fun field() = editor.editorComponent as? JTextField

    private fun text() = field()?.text?.trim() ?: editor.item?.toString()?.trim().orEmpty()

    private fun ensureEditor() {
        if (!isEditable) return
        val ui = ui as? BasicComboBoxUI ?: return
        val comp = editor.editorComponent ?: return
        if (components.none { it === comp }) ui.addEditor()
    }

    private fun set(value: String) {
        syncing = true
        try {
            selectedItem = value
            field()?.text = value
        } finally {
            syncing = false
        }
    }
}

private fun ordered(branches: List<String>, default: String): List<String> {
    val ordered = LinkedHashSet<String>()
    if (default.isNotBlank()) ordered.add(default)
    ordered.addAll(branches)
    return ordered.toList()
}

private fun model(branches: List<String>, default: String): ComboBoxModel<String> {
    return DefaultComboBoxModel(ordered(branches, default).toTypedArray())
}
