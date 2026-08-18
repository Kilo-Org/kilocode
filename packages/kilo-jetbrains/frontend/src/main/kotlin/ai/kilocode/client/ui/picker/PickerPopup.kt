package ai.kilocode.client.ui.picker

import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.HoverIcon
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import com.intellij.CommonBundle
import com.intellij.ide.ui.laf.darcula.ui.DarculaButtonUI
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.Disposable
import com.intellij.openapi.ui.popup.JBPopup
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.ui.popup.PopupShowOptions
import com.intellij.openapi.ui.popup.util.PopupUtil
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.IconLoader
import com.intellij.ui.CollectionListModel
import com.intellij.ui.DocumentAdapter
import com.intellij.ui.ListUtil
import com.intellij.ui.NewUI
import com.intellij.ui.ScrollPaneFactory
import com.intellij.ui.ScrollingUtil
import com.intellij.ui.SearchTextField
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
import javax.swing.Icon
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.JScrollPane
import javax.swing.KeyStroke
import javax.swing.ListSelectionModel
import javax.swing.ScrollPaneConstants
import javax.swing.SwingUtilities
import javax.swing.event.DocumentEvent

internal val popupBackground: Color
    get() = if (NewUI.isEnabled()) JBUI.CurrentTheme.Popup.BACKGROUND else UIUtil.getListBackground()

private val EXPAND: Icon = IconLoader.getIcon("/icons/expand.svg", PickerPopup::class.java)
private val COLLAPSE: Icon = IconLoader.getIcon("/icons/collapse.svg", PickerPopup::class.java)

internal class PickerPopup<T>(
    private val anchor: JComponent,
    private val placement: Placement,
    private val rows: (String) -> List<T>,
    private val model: CollectionListModel<T>,
    private val renderer: PickerListRenderer<T>,
    private val key: (T) -> Any? = { it as Any },
    private val mode: Mode,
    private val autoClose: Boolean = mode == Mode.Single,
    private val onPrimary: (T) -> Unit,
    private val sectionTitle: (List<T>, Int) -> String? = { _, _ -> null },
    private val trailingHit: ((JList<*>, java.awt.Rectangle, java.awt.Point) -> Boolean)? = null,
    private val onTrailing: ((T) -> Unit)? = null,
    private val search: Boolean = false,
    private val toolbar: List<JComponent> = emptyList(),
    private val details: JComponent? = null,
    private val onPreview: (T?) -> Unit = {},
    private val expandStateKey: String? = null,
    private val minWidth: Int = 420,
    private val maxWidth: Int = 760,
    private val maxVisibleRows: Int = 10,
    private val emptyListHeight: Int = 120,
    private val emptyText: String = KiloBundle.message("model.picker.no.matches"),
) {
    enum class Placement { ABOVE, BELOW, UNDERNEATH }
    enum class Mode { Single, Multi }

    private val props get() = PropertiesComponent.getInstance()
    private var expanded = expandStateKey?.let { props.getBoolean(it, false) } ?: false
    private val list = JBList(model).apply {
        selectionMode = ListSelectionModel.SINGLE_SELECTION
        isFocusable = !search
        this.emptyText.text = this@PickerPopup.emptyText
        background = popupBackground
        border = JBUI.Borders.empty(PopupUtil.getListInsets(false, false))
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        cellRenderer = renderer
    }
    private val field = if (search) SearchTextField(false).apply {
        textEditor.emptyText.text = KiloBundle.message("model.picker.search")
    } else null
    private val expand = details?.let {
        HoverIcon().apply { cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR) }
    }
    private lateinit var popup: JBPopup
    private lateinit var content: JPanel
    private lateinit var head: JComponent
    private lateinit var scroll: JScrollPane
    private var foot: JComponent? = null
    private var shown = false

    fun show(): JBPopup {
        installSearch()
        installKeys(list)
        installMouse()
        installExpand()
        list.addListSelectionListener {
            if (!it.valueIsAdjusting && expanded) preview()
        }
        ListUtil.installAutoSelectOnMouseMove(list)
        ScrollingUtil.installActions(list)

        head = header()
        foot = footer()
        scroll = ScrollPaneFactory.createScrollPane(list).apply {
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            verticalScrollBarPolicy = JScrollPane.VERTICAL_SCROLLBAR_AS_NEEDED
            border = JBUI.Borders.empty()
            viewportBorder = JBUI.Borders.empty()
            background = popupBackground
            viewport.background = popupBackground
            viewport.isOpaque = true
        }
        content = JPanel(BorderLayout()).apply {
            background = popupBackground
            border = JBUI.Borders.empty()
            add(head, BorderLayout.NORTH)
            add(scroll, BorderLayout.CENTER)
            foot?.let { add(it, BorderLayout.SOUTH) }
            details?.let { add(it, BorderLayout.EAST) }
        }
        PopupUtil.applyNewUIBackground(list)
        list.background = popupBackground
        field?.let {
            AbstractPopup.customizeSearchFieldLook(it, true)
            it.background = popupBackground
        }
        refresh()
        syncExpand()
        preview()
        resize()
        popup = JBPopupFactory.getInstance()
            .createComponentPopupBuilder(content, field?.textEditor ?: list)
            .setRequestFocus(true)
            .setFocusable(true)
            .setCancelOnClickOutside(true)
            .setCancelKeyEnabled(true)
            .setCancelOnWindowDeactivation(true)
            .setLocateWithinScreenBounds(true)
            .setResizable(false)
            .setMovable(false)
            .createPopup()
        if (details is Disposable) Disposer.register(popup, details)
        when (placement) {
            Placement.ABOVE -> popup.show(PopupShowOptions.aboveComponent(anchor))
            Placement.BELOW,
            Placement.UNDERNEATH -> popup.showUnderneathOf(anchor)
        }
        shown = true
        SwingUtilities.invokeLater {
            field?.let {
                it.textEditor.requestFocusInWindow()
                it.selectText()
            } ?: list.requestFocusInWindow()
            list.selectedIndex.takeIf { it >= 0 }?.let(list::ensureIndexIsVisible)
        }
        return popup
    }

    fun refresh(prefer: Any? = selectedKey(), at: Int? = null) {
        val data = rows(field?.text.orEmpty())
        model.replaceAll(data)
        val idx = at?.takeIf { it in data.indices }
            ?: prefer?.let { value -> data.indexOfFirst { it == value || key(it) == value }.takeIf { it >= 0 } }
            ?: data.indices.firstOrNull()
            ?: -1
        if (idx >= 0) choose(idx) else list.clearSelection()
        preview()
    }

    fun repaint() {
        list.repaint()
    }

    private fun header(): JComponent {
        val ins = PopupUtil.getListInsets(false, false)
        val pad = JBUI.CurrentTheme.Popup.Selection.LEFT_RIGHT_INSET.get()
        val head = JPanel(BorderLayout()).apply {
            background = popupBackground
            border = JBUI.Borders.empty(pad, ins.left, ins.bottom, pad)
        }
        field?.let { head.add(it.align(HAlign.TRACK, VAlign.CENTER), BorderLayout.CENTER) }
        val actions = toolbar + listOfNotNull(expand)
        if (actions.isNotEmpty()) {
            val bar = Stack.horizontal(JBUI.CurrentTheme.ActionsList.elementIconGap()).apply {
                actions.forEach { next(it) }
            }
            head.add(bar.align(HAlign.RIGHT, VAlign.CENTER), BorderLayout.EAST)
        }
        return head
    }

    private fun footer(): JComponent? {
        if (autoClose) return null
        val btn = JButton(CommonBundle.getCloseButtonText()).apply {
            putClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY, true)
            background = popupBackground
            isFocusable = false
            isRequestFocusEnabled = false
            addActionListener { popup.closeOk(null) }
        }
        return JPanel(BorderLayout()).apply {
            background = popupBackground
            border = JBUI.Borders.empty(UiStyle.Gap.pad(), UiStyle.Gap.pad(), UiStyle.Gap.pad(), UiStyle.Gap.pad())
            add(btn.align(HAlign.RIGHT, VAlign.CENTER), BorderLayout.CENTER)
        }
    }

    private fun installSearch() {
        val editor = field?.textEditor ?: return
        editor.document.addDocumentListener(object : DocumentAdapter() {
            override fun textChanged(e: DocumentEvent) {
                refresh()
            }
        })
        editor.registerKeyboardAction({ move(-1) }, KeyStroke.getKeyStroke(KeyEvent.VK_UP, 0), JComponent.WHEN_FOCUSED)
        editor.registerKeyboardAction({ move(1) }, KeyStroke.getKeyStroke(KeyEvent.VK_DOWN, 0), JComponent.WHEN_FOCUSED)
        installKeys(editor)
    }

    private fun installKeys(component: JComponent) {
        component.registerKeyboardAction({ list.selectedValue?.let(::primary) }, KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0), JComponent.WHEN_FOCUSED)
        component.registerKeyboardAction({ popup.cancel() }, KeyStroke.getKeyStroke(KeyEvent.VK_ESCAPE, 0), JComponent.WHEN_FOCUSED)
        if (mode == Mode.Multi) {
            component.registerKeyboardAction({ list.selectedValue?.let(::primary) }, KeyStroke.getKeyStroke(KeyEvent.VK_SPACE, 0), JComponent.WHEN_FOCUSED)
            return
        }
        if (onTrailing != null) {
            component.registerKeyboardAction({ list.selectedValue?.let(::trailing) }, KeyStroke.getKeyStroke(KeyEvent.VK_SPACE, InputEvent.SHIFT_DOWN_MASK), JComponent.WHEN_FOCUSED)
        }
    }

    private fun installMouse() {
        list.addMouseListener(object : MouseAdapter() {
            override fun mouseReleased(e: MouseEvent) {
                if (!UIUtil.isActionClick(e, MouseEvent.MOUSE_RELEASED, true)) return
                val idx = list.locationToIndex(e.point).takeIf { it >= 0 } ?: return
                val bounds = list.getCellBounds(idx, idx) ?: return
                if (!bounds.contains(e.point)) return
                val value = model.getElementAt(idx)
                if (trailingHit?.invoke(list, bounds, e.point) == true) {
                    trailing(value)
                    e.consume()
                    return
                }
                primary(value)
                e.consume()
            }
        })
    }

    private fun installExpand() {
        expand?.addActionListener { setExpanded(!expanded) }
    }

    private fun primary(value: T) {
        onPrimary(value)
        if (autoClose) {
            popup.closeOk(null)
            return
        }
        refresh(at = list.selectedIndex)
        list.repaint()
    }

    private fun trailing(value: T) {
        val block = onTrailing ?: return
        val idx = list.selectedIndex
        block(value)
        refresh(at = idx)
        list.getCellBounds(list.selectedIndex, list.selectedIndex)?.let(list::repaint)
        preview()
    }

    private fun choose(idx: Int) {
        list.selectedIndex = idx
        ScrollingUtil.ensureIndexIsVisible(list, idx, 0)
    }

    private fun move(step: Int) {
        val size = model.size
        if (size <= 0) return
        val cur = list.selectedIndex.takeIf { it >= 0 } ?: 0
        choose((cur + step).coerceIn(0, size - 1))
    }

    private fun preview() {
        onPreview(list.selectedValue)
    }

    private fun setExpanded(value: Boolean) {
        if (expanded == value) return
        expanded = value
        expandStateKey?.let { props.setValue(it, value.toString()) }
        if (!expanded) list.clearSelection()
        syncExpand()
        preview()
        resize()
    }

    private fun syncExpand() {
        val details = details ?: return
        val expand = expand ?: return
        expand.icon = if (expanded) COLLAPSE else EXPAND
        expand.toolTipText = if (expanded) {
            KiloBundle.message("model.picker.details.minimize")
        } else {
            KiloBundle.message("model.picker.details.maximize")
        }
        expand.accessibleContext.accessibleName = expand.toolTipText
        details.isVisible = expanded
    }

    private fun resize() {
        val size = computeInitialPopupSize(list, scroll, head, foot, expanded)
        content.preferredSize = size
        if (expanded && details != null) {
            details.preferredSize = Dimension(size.width - scroll.preferredSize.width, scroll.preferredSize.height)
        }
        content.revalidate()
        content.repaint()
        if (shown) popup.setSize(size)
    }

    private fun selectedKey(): Any? = list.selectedValue?.let(key)

    private fun computeInitialPopupSize(list: JList<T>, scroll: JScrollPane, head: JComponent, foot: JComponent?, expanded: Boolean): Dimension {
        val width = maxOf(
            computeListPreferredWidth(list),
            head.preferredSize.width.coerceIn(JBUI.scale(minWidth), JBUI.scale(maxWidth)),
            foot?.preferredSize?.width?.coerceIn(JBUI.scale(minWidth), JBUI.scale(maxWidth)) ?: 0,
        )
        list.fixedCellWidth = width
        val height = computeListPreferredHeight(list)
        val bar = if (list.model.size > maxVisibleRows) scroll.verticalScrollBar.preferredSize.width else 0
        val listWidth = width + bar
        val detailWidth = if (expanded && details != null) width else 0
        val footHeight = foot?.preferredSize?.height ?: 0
        val size = Dimension(listWidth + detailWidth, head.preferredSize.height + height + footHeight)
        scroll.preferredSize = Dimension(listWidth, height)
        return size
    }

    private fun computeListPreferredWidth(list: JList<T>): Int {
        val renderer = list.cellRenderer ?: return JBUI.scale(minWidth)
        val model = list.model
        val max = (0 until model.size).maxOfOrNull { idx ->
            val value = model.getElementAt(idx)
            renderer.getListCellRendererComponent(list, value, idx, false, false).preferredSize.width
        } ?: 0
        val ins = list.insets
        return (max + ins.left + ins.right).coerceIn(JBUI.scale(minWidth), JBUI.scale(maxWidth))
    }

    private fun computeListPreferredHeight(list: JList<T>): Int {
        val renderer = list.cellRenderer ?: return JBUI.scale(emptyListHeight)
        val model = list.model
        val count = model.size.coerceAtMost(maxVisibleRows)
        if (count <= 0) return JBUI.scale(emptyListHeight)
        val height = (0 until count).sumOf { idx ->
            val value = model.getElementAt(idx)
            renderer.getListCellRendererComponent(list, value, idx, false, false).preferredSize.height
        }
        val ins = list.insets
        return height + ins.top + ins.bottom
    }
}
