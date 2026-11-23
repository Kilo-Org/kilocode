package ai.kilocode.client.agentManager.worktree

import ai.kilocode.client.session.ui.prompt.PromptFuzzyRanker
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.ui.DocumentAdapter
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Dimension
import java.awt.event.FocusAdapter
import java.awt.event.FocusEvent
import javax.swing.ComboBoxModel
import javax.swing.DefaultComboBoxModel
import javax.swing.JTextField
import javax.swing.event.DocumentEvent
import javax.swing.event.PopupMenuEvent
import javax.swing.event.PopupMenuListener
import javax.swing.plaf.basic.BasicComboBoxUI
import javax.swing.plaf.basic.BasicComboPopup

internal class BranchPicker(branches: List<String>, private val default: String = "") :
    ComboBox<String>(model(branches, default)) {
    private val branches = ordered(branches, default)
    private val set = this.branches.toSet()
    private var syncing = false
    private var revision = 0

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

    @RequiresEdt
    private fun wire() {
        val field = field() ?: return
        field.document.addDocumentListener(object : DocumentAdapter() {
            override fun textChanged(e: DocumentEvent) {
                if (!syncing) update(field)
            }
        })
        field.addFocusListener(object : FocusAdapter() {
            override fun focusLost(e: FocusEvent) {
                revision++
                restore()
            }
        })
        addPopupMenuListener(object : PopupMenuListener {
            override fun popupMenuWillBecomeVisible(e: PopupMenuEvent) = Unit
            override fun popupMenuWillBecomeInvisible(e: PopupMenuEvent) { revision++ }
            override fun popupMenuCanceled(e: PopupMenuEvent) { revision++ }
        })
    }

    @RequiresEdt
    private fun update(field: JTextField) {
        val token = ++revision
        sync(field.text)
        if (!isShowing || isPopupVisible || field.text.isBlank()) return
        val owner = DialogWrapper.findInstance(this)
        // Opening configures the editor, so wait until document notifications and caret updates finish.
        ApplicationManager.getApplication().invokeLater({
            val active = token == revision && isShowing && isEnabled
            val current = field() === field && field.isFocusOwner
            val available = !isPopupVisible && owner?.isDisposed != true
            if (!active || !current || !available) return@invokeLater
            val text = field.text
            if (text.isBlank() || text == selectedItem?.toString()) return@invokeLater
            val dot = field.caret.dot
            val mark = field.caret.mark
            syncing = true
            try {
                isPopupVisible = true
                if (field.text != text) field.text = text
                field.caret.setDot(mark)
                field.caret.moveDot(dot)
                sync(text)
            } finally {
                syncing = false
            }
        }, ModalityState.stateForComponent(this))
    }

    @RequiresEdt
    override fun removeNotify() {
        revision++
        super.removeNotify()
    }

    private fun restore() {
        if (default.isBlank() || text().isNotEmpty()) return
        set(default)
    }

    @RequiresEdt
    private fun sync(text: String) {
        val value = text.trim()
        if (value.isEmpty()) return
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

    @RequiresEdt
    private fun set(value: String) {
        revision++
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
