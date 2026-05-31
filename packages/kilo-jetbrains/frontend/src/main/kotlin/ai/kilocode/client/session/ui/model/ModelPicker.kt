package ai.kilocode.client.session.ui.model

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.PickerButton
import ai.kilocode.rpc.dto.ModelSelectionDto
import com.intellij.openapi.ui.popup.JBPopup
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.ui.popup.PopupShowOptions
import com.intellij.openapi.ui.popup.util.PopupUtil
import com.intellij.ui.CollectionListModel
import com.intellij.ui.DocumentAdapter
import com.intellij.ui.JBColor
import com.intellij.ui.NewUI
import com.intellij.ui.ListUtil
import com.intellij.ui.SearchTextField
import com.intellij.ui.ScrollPaneFactory
import com.intellij.ui.ScrollingUtil
import com.intellij.ui.components.JBList
import com.intellij.ui.popup.AbstractPopup
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Cursor
import java.awt.Dimension
import java.awt.event.InputEvent
import java.awt.event.KeyEvent
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.JScrollPane
import javax.swing.KeyStroke
import javax.swing.ListSelectionModel
import javax.swing.ScrollPaneConstants
import javax.swing.SwingUtilities
import javax.swing.event.DocumentEvent

private val popupBackground: Color
    get() = if (NewUI.isEnabled()) JBUI.CurrentTheme.Popup.BACKGROUND else UIUtil.getListBackground()

private const val MODEL_PICKER_MIN_WIDTH = 420
private const val MODEL_PICKER_MAX_WIDTH = 760
private const val MODEL_PICKER_MAX_VISIBLE_ROWS = 10
private const val MODEL_PICKER_EMPTY_LIST_HEIGHT = 120

class ModelPicker : PickerButton() {

    data class Item(
        val id: String,
        val display: String,
        val provider: String,
        val providerName: String,
        val recommendedIndex: Double? = null,
        val free: Boolean = false,
        val variants: List<String> = emptyList(),
    ) {
        val key: String get() = "$provider/$id"

        override fun toString(): String = listOf(display, id, providerName).joinToString(" ")
    }

    var onSelect: (Item) -> Unit = {}
    var favorites: () -> List<ModelSelectionDto> = { emptyList() }
    var onFavoriteToggle: (Item) -> Unit = {}

    private var items: List<Item> = emptyList()
    private var selected: Item? = null

    init {
        isEnabled = false
        text = " "
        toolTipText = KiloBundle.message("model.picker.tooltip")

        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (!isEnabled || items.isEmpty()) return
                showPopup()
            }
        })
    }

    fun setItems(values: List<Item>, default: String? = null) {
        items = values
        val key = default ?: selected?.key
        selected = key?.let { target -> values.firstOrNull { it.key == target || it.id == target } }
            ?: values.firstOrNull()
        refresh()
    }

    fun select(key: String) {
        selected = items.firstOrNull { it.key == key || it.id == key }
        refresh()
    }

    internal fun selectedForTest(): Item? = selected

    private fun refresh() {
        if (items.isEmpty()) {
            isEnabled = false
            text = " "
            cursor = Cursor.getDefaultCursor()
            return
        }
        val display = selected?.display ?: items.firstOrNull()?.display ?: ""
        text = "${ModelText.sanitize(display)} ▴"
        isEnabled = true
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
    }

    private fun showPopup() {
        val rows = modelPickerRows(items, favorites(), "")
        val model = CollectionListModel(rows)
        val list = JBList(model).apply {
            selectionMode = ListSelectionModel.SINGLE_SELECTION
            isFocusable = false
            emptyText.text = KiloBundle.message("model.picker.no.matches")
            background = popupBackground
            border = JBUI.Borders.empty(PopupUtil.getListInsets(false, false))
            cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        }
        list.cellRenderer = ModelPickerRenderer(
            model = model,
            active = { selected?.key },
            favorites = { favoriteKeys() },
        )
        val search = SearchTextField(false).apply {
            textEditor.emptyText.text = KiloBundle.message("model.picker.search")
        }

        lateinit var popup: JBPopup

        fun activeKey(): String? = list.selectedValue?.item?.key

        fun choose(idx: Int) {
            list.selectedIndex = idx
            ScrollingUtil.ensureIndexIsVisible(list, idx, 0)
        }

        fun sync(prefer: String? = activeKey(), at: Int? = null) {
            val rows = modelPickerRows(items, favorites(), search.text)
            model.replaceAll(rows)
            val idx = at?.let { modelPickerIndex(rows, it) }?.takeIf { it >= 0 }
                ?: modelPickerIndex(rows, prefer).takeIf { it >= 0 }
                ?: modelPickerIndex(rows, selected?.key).takeIf { it >= 0 }
                ?: rows.indices.firstOrNull()
                ?: -1
            if (idx >= 0) choose(idx)
            else list.clearSelection()
        }

        fun activate(item: Item) {
            selected = item
            refresh()
            onSelect(item)
            popup.closeOk(null)
        }

        fun move(step: Int) {
            val size = model.size
            if (size <= 0) return
            val cur = list.selectedIndex.takeIf { it >= 0 } ?: 0
            val idx = (cur + step).coerceIn(0, size - 1)
            choose(idx)
        }

        fun toggle(row: ModelPickerRow) {
            val idx = list.selectedIndex
            onFavoriteToggle(row.item)
            sync(at = idx)
            list.selectedIndex.takeIf { it >= 0 }?.let { repaintRow(list, it) }
        }

        search.textEditor.document.addDocumentListener(object : DocumentAdapter() {
            override fun textChanged(e: DocumentEvent) {
                sync()
            }
        })
        search.textEditor.registerKeyboardAction(
            { move(-1) },
            KeyStroke.getKeyStroke(KeyEvent.VK_UP, 0),
            JComponent.WHEN_FOCUSED,
        )
        search.textEditor.registerKeyboardAction(
            { move(1) },
            KeyStroke.getKeyStroke(KeyEvent.VK_DOWN, 0),
            JComponent.WHEN_FOCUSED,
        )
        search.textEditor.registerKeyboardAction(
            { list.selectedValue?.item?.let(::activate) },
            KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0),
            JComponent.WHEN_FOCUSED,
        )
        search.textEditor.registerKeyboardAction(
            { popup.cancel() },
            KeyStroke.getKeyStroke(KeyEvent.VK_ESCAPE, 0),
            JComponent.WHEN_FOCUSED,
        )
        search.textEditor.registerKeyboardAction(
            { list.selectedValue?.let(::toggle) },
            KeyStroke.getKeyStroke(KeyEvent.VK_SPACE, InputEvent.SHIFT_DOWN_MASK),
            JComponent.WHEN_FOCUSED,
        )
        list.registerKeyboardAction(
            { list.selectedValue?.item?.let(::activate) },
            KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0),
            JComponent.WHEN_FOCUSED,
        )
        list.registerKeyboardAction(
            { popup.cancel() },
            KeyStroke.getKeyStroke(KeyEvent.VK_ESCAPE, 0),
            JComponent.WHEN_FOCUSED,
        )
        list.registerKeyboardAction(
            { list.selectedValue?.let(::toggle) },
            KeyStroke.getKeyStroke(KeyEvent.VK_SPACE, InputEvent.SHIFT_DOWN_MASK),
            JComponent.WHEN_FOCUSED,
        )
        list.addMouseListener(object : MouseAdapter() {
            override fun mouseReleased(e: MouseEvent) {
                if (!UIUtil.isActionClick(e, MouseEvent.MOUSE_RELEASED, true)) return
                val row = list.locationToIndex(e.point)
                val bounds = row.takeIf { it >= 0 }?.let { list.getCellBounds(it, it) } ?: return
                if (!bounds.contains(e.point)) return
                val value = model.getElementAt(row)
                if (ModelPickerRenderer.isFavoriteClick(list, bounds, e.point)) {
                    toggle(value)
                    e.consume()
                    return
                }
                activate(value.item)
            }
        })
        ListUtil.installAutoSelectOnMouseMove(list)
        ScrollingUtil.installActions(list)

        val scroll = ScrollPaneFactory.createScrollPane(list).apply {
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            verticalScrollBarPolicy = JScrollPane.VERTICAL_SCROLLBAR_AS_NEEDED
            border = JBUI.Borders.empty()
            viewportBorder = JBUI.Borders.empty()
            background = popupBackground
            viewport.background = popupBackground
            viewport.isOpaque = true
        }
        val content = JPanel(BorderLayout()).apply {
            background = popupBackground
            border = JBUI.Borders.empty()
            add(search, BorderLayout.NORTH)
            add(scroll, BorderLayout.CENTER)
        }
        PopupUtil.applyNewUIBackground(list)
        list.background = popupBackground
        AbstractPopup.customizeSearchFieldLook(search, true)
        search.background = popupBackground

        sync(selected?.key)
        content.preferredSize = computeInitialPopupSize(list, scroll, search)
        popup = JBPopupFactory.getInstance()
            .createComponentPopupBuilder(content, search.textEditor)
            .setRequestFocus(true)
            .setFocusable(true)
            .setCancelOnClickOutside(true)
            .setCancelKeyEnabled(true)
            .setCancelOnWindowDeactivation(true)
            .setLocateWithinScreenBounds(true)
            .setResizable(false)
            .setMovable(false)
            .createPopup()

        popup.show(PopupShowOptions.aboveComponent(this))
        SwingUtilities.invokeLater {
            search.textEditor.requestFocusInWindow()
            search.selectText()
            list.selectedIndex.takeIf { it >= 0 }?.let(list::ensureIndexIsVisible)
        }
    }

    private fun favoriteKeys(): Set<String> = favorites().mapTo(mutableSetOf()) { "${it.providerID}/${it.modelID}" }
}

internal data class ModelPickerRow(
    val item: ModelPicker.Item,
    val section: String?,
    val favorite: Boolean,
)

private fun computeInitialPopupSize(
    list: JList<ModelPickerRow>,
    scroll: JScrollPane,
    search: SearchTextField,
): Dimension {
    val width = computeListPreferredWidth(list)
    list.fixedCellWidth = width

    val height = computeListPreferredHeight(list)
    val bar = if (list.model.size > MODEL_PICKER_MAX_VISIBLE_ROWS) scroll.verticalScrollBar.preferredSize.width else 0
    val content = Dimension(width + bar, search.preferredSize.height + height)
    scroll.preferredSize = Dimension(content.width, height)
    return content
}

private fun computeListPreferredWidth(list: JList<ModelPickerRow>): Int {
    val renderer = list.cellRenderer ?: return JBUI.scale(MODEL_PICKER_MIN_WIDTH)
    val model = list.model
    val max = (0 until model.size).maxOfOrNull { idx ->
        val value = model.getElementAt(idx)
        renderer.getListCellRendererComponent(list, value, idx, false, false).preferredSize.width
    } ?: 0
    val insets = list.insets
    return (max + insets.left + insets.right).coerceIn(
        JBUI.scale(MODEL_PICKER_MIN_WIDTH),
        JBUI.scale(MODEL_PICKER_MAX_WIDTH),
    )
}

private fun computeListPreferredHeight(list: JList<ModelPickerRow>): Int {
    val renderer = list.cellRenderer ?: return JBUI.scale(MODEL_PICKER_EMPTY_LIST_HEIGHT)
    val model = list.model
    val count = model.size.coerceAtMost(MODEL_PICKER_MAX_VISIBLE_ROWS)
    if (count <= 0) return JBUI.scale(MODEL_PICKER_EMPTY_LIST_HEIGHT)
    val height = (0 until count).sumOf { idx ->
        val value = model.getElementAt(idx)
        renderer.getListCellRendererComponent(list, value, idx, false, false).preferredSize.height
    }
    val insets = list.insets
    return height + insets.top + insets.bottom
}

private fun repaintRow(list: JList<*>, index: Int) {
    if (index < 0) return
    list.getCellBounds(index, index)?.let(list::repaint)
}

internal object ModelSearch {
    fun matches(query: String, text: String): Boolean {
        val q = query.lowercase().trim()
        if (q.isEmpty()) return true
        val parts = words(q)
        if (parts.isEmpty()) return true
        return parts.all { acronym(text, it) }
    }

    fun acronym(text: String, query: String): Boolean {
        val words = words(text)
        fun attempt(wi: Int, qi: Int): Boolean {
            if (qi == query.length) return true
            if (wi >= words.size) return false
            val word = words[wi]
            var count = 0
            while (qi + count < query.length && count < word.length && word[count] == query[qi + count]) {
                count++
            }
            if (count > 0 && attempt(wi + 1, qi + count)) return true
            return attempt(wi + 1, qi)
        }
        return attempt(0, 0)
    }

    private fun words(text: String): List<String> {
        val out = mutableListOf<String>()
        val buf = StringBuilder()
        fun flush() {
            if (buf.isEmpty()) return
            out += buf.toString().lowercase()
            buf.clear()
        }
        for (ch in text) {
            if (ch in "[]_.: /\\(){}-") {
                flush()
                continue
            }
            if (ch.isUpperCase() && buf.isNotEmpty()) flush()
            buf.append(ch)
        }
        flush()
        return out
    }
}

internal object ModelText {
    private val small = setOf("kilo-auto/small", "auto-small")

    data class Parts(val provider: String?, val model: String)

    fun sanitize(text: String): String = text.replace(Regex("[\\s:_-]*\\(free\\)\\s*$", RegexOption.IGNORE_CASE), "").trim()

    fun parts(item: ModelPicker.Item): Parts {
        val text = sanitize(item.display)
        val colon = text.indexOf(':')
        if (colon > 0) {
            val prefix = text.substring(0, colon).trim()
            val model = text.substring(colon + 1).trim()
            if (prefix.isNotEmpty() && model.isNotEmpty()) return Parts(prefix, model)
        }
        val prefix = item.providerName.trim()
        if (prefix.isNotEmpty() && text.length > prefix.length && text.startsWith(prefix, ignoreCase = true) && text[prefix.length].isWhitespace()) {
            val model = text.substring(prefix.length).trim()
            if (model.isNotEmpty()) return Parts(text.substring(0, prefix.length), model)
        }
        return Parts(null, text)
    }

    fun small(item: ModelPicker.Item): Boolean = item.provider == "kilo" && item.id in small

    fun providerSort(id: String): Int = if (id == "kilo") 0 else 1

    fun freeBg(): JBColor = JBColor.namedColor("Kilo.ModelPicker.freeBadgeBackground", JBColor(0x95D6AC, 0x7FCA99))
}
