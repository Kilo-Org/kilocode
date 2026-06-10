package ai.kilocode.client.session.ui.selection

import ai.kilocode.client.session.ui.style.SessionEditorStyle
import com.intellij.openapi.Disposable
import com.intellij.openapi.editor.colors.EditorColors
import com.intellij.openapi.editor.event.SelectionEvent
import com.intellij.openapi.editor.event.SelectionListener
import com.intellij.openapi.editor.ex.EditorEx
import com.intellij.openapi.util.Disposer
import com.intellij.ui.EditorTextField
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Color
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.lang.ref.WeakReference
import javax.swing.event.CaretEvent
import javax.swing.event.CaretListener
import javax.swing.text.JTextComponent

class SessionSelection : Disposable {
    private val items = linkedSetOf<Item>()
    private var active: Item? = null
    private var style: SessionEditorStyle? = null
    private var clearing = false
    private var disposed = false

    @RequiresEdt
    fun selectedText(): String? {
        active?.selectedText()?.takeIf { it.isNotEmpty() }?.let { return it }
        val item = items.toList().asReversed().firstOrNull { !it.selectedText().isNullOrEmpty() }
        if (item == null) {
            active = null
            return null
        }
        active = item
        clearExcept(item)
        return item.selectedText()?.takeIf { it.isNotEmpty() }
    }

    @RequiresEdt
    fun register(component: JTextComponent, parent: Disposable? = null): Disposable {
        val item = TextItem(component)
        add(item, parent)
        return item
    }

    @RequiresEdt
    fun register(field: EditorTextField, parent: Disposable? = null): Disposable {
        val item = FieldItem(field)
        add(item, parent)
        return item
    }

    @RequiresEdt
    fun register(editor: EditorEx, parent: Disposable? = null): Disposable {
        val item = EditorItem(editor)
        add(item, parent)
        return item
    }

    @RequiresEdt
    private fun clearExcept(item: Item) {
        if (clearing) return
        clearing = true
        try {
            for (entry in items) {
                if (entry !== item) entry.clearSelection()
            }
        } finally {
            clearing = false
        }
    }

    @RequiresEdt
    fun clear() {
        if (clearing) return
        clearing = true
        try {
            for (entry in items) entry.clearSelection()
            active = null
        } finally {
            clearing = false
        }
    }

    @RequiresEdt
    fun applyStyle(style: SessionEditorStyle) {
        this.style = style
        for (item in items) item.applyStyle(style)
    }

    @RequiresEdt
    override fun dispose() {
        disposed = true
        clear()
        val copy = items.toList()
        for (item in copy) item.dispose()
        items.clear()
        active = null
    }

    @RequiresEdt
    private fun add(item: Item, parent: Disposable?) {
        if (disposed) return
        items.add(item)
        style?.let(item::applyStyle)
        parent?.let { Disposer.register(it, item) }
    }

    @RequiresEdt
    private fun changed(item: Item) {
        if (clearing || item.disposed) return
        if (!items.contains(item)) return
        if (!item.selectedText().isNullOrEmpty()) {
            active = item
            clearExcept(item)
            return
        }
        if (active === item) active = null
    }

    @RequiresEdt
    private fun started(item: Item) {
        if (clearing || item.disposed) return
        if (!items.contains(item)) return
        active = item
        clearExcept(item)
    }

    private interface Item : Disposable {
        val disposed: Boolean
        fun selectedText(): String?
        fun clearSelection()
        fun applyStyle(style: SessionEditorStyle)
    }

    private inner class TextItem(private val component: JTextComponent) : Item, CaretListener {
        private val mouse = object : MouseAdapter() {
            override fun mousePressed(e: MouseEvent) = started(this@TextItem)
        }

        override var disposed = false
            private set

        init {
            component.caret.isSelectionVisible = true
            component.caret.isVisible = false
            component.isFocusable = true
            component.isRequestFocusEnabled = true
            component.addCaretListener(this)
            component.addMouseListener(mouse)
        }

        override fun caretUpdate(e: CaretEvent) = changed(this)

        override fun selectedText(): String? = component.selectedText

        override fun clearSelection() {
            val pos = component.selectionStart.coerceIn(0, component.document.length)
            component.caretPosition = pos
        }

        override fun applyStyle(style: SessionEditorStyle) {
            selectionColors(style, component.selectionColor, component.selectedTextColor).let {
                component.selectionColor = it.first
                component.selectedTextColor = it.second
            }
        }

        override fun dispose() {
            if (disposed) return
            disposed = true
            component.removeCaretListener(this)
            component.removeMouseListener(mouse)
            if (active === this) active = null
            items.remove(this)
        }
    }

    private inner class FieldItem(private val field: EditorTextField) : Item, SelectionListener {
        private var editor: EditorEx? = null
        private var reg: Disposable? = null
        override var disposed = false
            private set

        init {
            field.getEditor(false)?.let(::bind)
            val ref = WeakReference(this)
            field.addSettingsProvider { ed -> ref.get()?.bind(ed) }
        }

        override fun selectedText(): String? = editor?.selectionModel?.selectedText

        override fun clearSelection() {
            editor?.selectionModel?.removeSelection()
        }

        override fun applyStyle(style: SessionEditorStyle) {
            editor?.let(style::applyToEditor)
        }

        override fun selectionChanged(e: SelectionEvent) = changed(this)

        override fun dispose() {
            if (disposed) return
            disposed = true
            reg?.let(Disposer::dispose)
            reg = null
            editor = null
            if (active === this) active = null
            items.remove(this)
        }

        private fun bind(editor: EditorEx) {
            if (disposed || this.editor != null) return
            this.editor = editor
            val disposable = Disposer.newDisposable("Session selection editor")
            reg = disposable
            editor.selectionModel.addSelectionListener(this, disposable)
            style?.let(::applyStyle)
        }
    }

    private inner class EditorItem(private val editor: EditorEx) : Item, SelectionListener {
        override var disposed = false
            private set

        init {
            editor.selectionModel.addSelectionListener(this, this)
        }

        override fun selectionChanged(e: SelectionEvent) = changed(this)

        override fun selectedText(): String? = editor.selectionModel.selectedText

        override fun clearSelection() {
            editor.selectionModel.removeSelection()
        }

        override fun applyStyle(style: SessionEditorStyle) {
            style.applyToEditor(editor)
        }

        override fun dispose() {
            if (disposed) return
            disposed = true
            if (active === this) active = null
            items.remove(this)
        }
    }

    private fun selectionColors(style: SessionEditorStyle, bg: Color?, fg: Color?): Pair<Color, Color> {
        val scheme = style.editorScheme
        return (scheme.getColor(EditorColors.SELECTION_BACKGROUND_COLOR) ?: bg ?: style.editorBackground) to
            (scheme.getColor(EditorColors.SELECTION_FOREGROUND_COLOR) ?: fg ?: style.editorForeground)
    }
}
