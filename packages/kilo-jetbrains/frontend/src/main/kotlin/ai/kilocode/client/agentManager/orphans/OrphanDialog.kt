package ai.kilocode.client.agentManager.orphans

import ai.kilocode.client.agentManager.worktree.KiloWorktreeService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.rpc.dto.orphans.OrphanDto
import ai.kilocode.rpc.dto.orphans.OrphanKind
import com.intellij.icons.AllIcons
import com.intellij.ide.actions.RevealFileAction
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.util.text.StringUtil
import com.intellij.ui.EditorNotificationPanel
import com.intellij.ui.InlineBanner
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.labels.LinkLabel
import com.intellij.xml.util.XmlStringUtil
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.table.JBTable
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.components.BorderLayoutPanel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.awt.Component
import java.awt.Cursor
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import java.awt.event.MouseMotionAdapter
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JTable
import javax.swing.table.AbstractTableModel
import javax.swing.table.TableCellRenderer
import javax.swing.table.TableColumn

private const val COLUMN_CHECK = 0
private const val COLUMN_PATH = 1
private const val COLUMN_SIZE = 2
private const val COLUMN_CONTENTS = 3
private const val COLUMN_REVEAL = 4

private const val WIDTH = 560
private const val HEIGHT = 360

/**
 * Resolve dialog for leftover worktree folders: select which to delete, see their full path and
 * apparent size, open one in the host OS's file manager, and confirm a background delete.
 *
 * The dialog performs no deletion itself — it records [result] and closes; the caller ([OrphanBanner])
 * runs the removal in the background so the modal never blocks on it, matching
 * [ai.kilocode.client.agentManager.worktree.NewWorktreeDialog]'s split between "what the user
 * confirmed" and "what happens next".
 */
internal class OrphanDialog(
    parent: Component,
    private val project: Project,
    orphans: List<OrphanDto>,
    initialSizes: Map<String, Long>,
) : DialogWrapper(parent, false) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val model = OrphanTableModel(
        orphans.map { OrphanRow(it, selected = it.kind == OrphanKind.LEFTOVER, size = initialSizes[it.path]) },
    )
    private val table = object : JBTable(model) {
        /**
         * Per-cell tooltips: the path column truncates long paths, and the reveal column is icon-only,
         * so both need to say what they are. Registration with the tooltip manager comes from the
         * `toolTipText` assignment below — overriding this alone would never be consulted.
         */
        override fun getToolTipText(event: MouseEvent): String? {
            val row = rowAtPoint(event.point)
            if (row < 0) return null
            return when (columnAtPoint(event.point)) {
                // Qualified: JBTable has a `model` of its own, and it is the untyped TableModel.
                COLUMN_PATH -> this@OrphanDialog.model.rows[row].orphan.path
                COLUMN_REVEAL -> RevealFileAction.getActionName()
                else -> null
            }
        }
    }.apply {
        rowHeight = JBUI.scale(22)
        toolTipText = ""
        // A `HEADER_ROW` model event makes JTable rebuild its columns from the model, which throws away
        // every width set below (and clears the row selection). The select-all header indicator needs a
        // header repaint on every toggle, so the model is deliberately not allowed to drive that.
        autoCreateColumnsFromModel = false
        columnModel.getColumn(COLUMN_CHECK).fix(JBCheckBox().preferredSize.width + UiStyle.Gap.xs())
        columnModel.getColumn(COLUMN_REVEAL).fix(AllIcons.Nodes.Folder.iconWidth + UiStyle.Gap.pad())
        columnModel.getColumn(COLUMN_CONTENTS).preferredWidth = JBUI.scale(160)
    }
    private val footer = JBLabel()

    private var confirmed = false
    private var center: JComponent? = null
    private var north: JComponent? = null

    // The three bullets are the collapsible detail; the intro sentence always stays visible so
    // collapsing never hides the point of the dialog, only the specifics. `helpWidth` is fixed at
    // banner creation (see createNorthPanel) and reused on every toggle so the HTML body keeps
    // wrapping at the same width instead of the dialog's current, possibly user-resized, one.
    private var helpExpanded = false
    private var helpWidth = 0
    private lateinit var helpBanner: InlineBanner
    private lateinit var helpToggle: LinkLabel<Runnable>

    init {
        title = KiloBundle.message("worktree.orphans.dialogTitle")
        setOKButtonText(deleteLabel())
        setCancelButtonText(KiloBundle.message("worktree.orphans.cancel"))
        init()
        model.addTableModelListener {
            syncFooter()
            table.tableHeader.repaint()
        }
        installSelectAllHeader()
        installReveal()
        syncFooter()
    }

    /**
     * Explains where these folders come from before offering to delete them: the list is the result of
     * a heuristic over a directory Kilo owns, and "delete 47 folders" is not a decision a user can make
     * from paths and sizes alone.
     */
    override fun createNorthPanel(): JComponent {
        // Standard info banner: rounded fill and border from JBUI.CurrentTheme.Banner.INFO_*, plus the
        // platform information icon. Not dismissible — it is the explanation for the choice below it.
        val banner = InlineBanner("", EditorNotificationPanel.Status.Info).showCloseButton(false)
        // Bounded in CSS pixels, which are this component's own scaled pixels, so the text wraps with the
        // table instead of stretching the dialog to one long line. Budget is the dialog content width less
        // the banner's own padding (read from it rather than restated) and the strip its status icon takes.
        helpWidth = JBUI.scale(WIDTH) - 2 * UiStyle.Gap.pad() - banner.insets.left - banner.insets.right -
            EditorNotificationPanel.Status.Info.icon.iconWidth - UiStyle.Gap.lg()
        helpBanner = banner
        banner.setMessage(XmlStringUtil.wrapInHtml(helpBody()))
        // Public overload only — createActionLabel/removeAllActions are @ApiStatus.Internal. The link
        // lands in InlineBanner's action row, which InlineBannerBase's VerticalLayout places under the
        // message, so it reads as "intro [+ bullets] / Show more|less" in both states.
        helpToggle = banner.addAction(helpToggleLabel(), null) { toggleHelp() }
        val panel = BorderLayoutPanel()
        // The outer margin goes on a wrapper: the banner's own border is padding inside its rounded fill.
        panel.addToCenter(banner)
        panel.border = JBUI.Borders.empty(UiStyle.Gap.PAD, UiStyle.Gap.PAD, 0, UiStyle.Gap.PAD)
        north = banner
        return panel
    }

    private fun helpBody(): String = buildString {
        append("<body style='width: ${helpWidth}px'>")
        append(escape("worktree.orphans.help.intro"))
        if (helpExpanded) {
            append("<ul style='margin-top: ${UiStyle.Gap.md()}px; margin-bottom: 0'>")
            append("<li>").append(escape("worktree.orphans.help.checkout")).append("</li>")
            append("<li>").append(escape("worktree.orphans.help.causes")).append("</li>")
            append("<li>").append(escape("worktree.orphans.help.delete")).append("</li>")
            append("</ul>")
        }
        append("</body>")
    }

    private fun helpToggleLabel(): String =
        KiloBundle.message(if (helpExpanded) "worktree.orphans.help.less" else "worktree.orphans.help.more")

    private fun toggleHelp() {
        helpExpanded = !helpExpanded
        helpBanner.setMessage(XmlStringUtil.wrapInHtml(helpBody()))
        helpToggle.text = helpToggleLabel()
        helpBanner.revalidate()
        helpBanner.repaint()
        // The banner grew or shrank; repack so the table keeps its own WIDTH x HEIGHT instead of being
        // squeezed by (or leaving slack under) the new banner height.
        pack()
    }

    override fun createCenterPanel(): JComponent {
        val panel = BorderLayoutPanel()
        // The overlay scrollbar paints over the viewport instead of taking layout space, so without a
        // right inset it covers the reveal column. A viewport border is what reserves that strip: Swing
        // widens the column header by the same insets, so header and rows stay aligned.
        panel.addToCenter(JBScrollPane(table).apply { viewportBorder = JBUI.Borders.emptyRight(UiStyle.Gap.XL) })
        panel.addToBottom(footer.apply { border = JBUI.Borders.empty(UiStyle.Gap.SM, 0, 0, 0) })
        panel.border = JBUI.Borders.empty(UiStyle.Gap.PAD)
        panel.preferredSize = JBUI.size(WIDTH, HEIGHT)
        center = panel
        return panel
    }

    private fun escape(key: String): String = XmlStringUtil.escapeString(KiloBundle.message(key))

    /** The built content, so tests can drive the real Swing tree without showing the modal dialog. */
    internal fun centerComponent(): JComponent = center ?: error("center panel not built")

    /** The built explanation header. A headless [DialogWrapper] peer has no root pane to walk. */
    internal fun northComponent(): JComponent = north ?: error("north panel not built")

    /** The rendered "Delete N folders (X)" label, so tests can assert it without showing the dialog. */
    internal fun okButtonText(): String? = getOKAction().getValue(javax.swing.Action.NAME) as? String

    public override fun doOKAction() {
        confirmed = true
        close(OK_EXIT_CODE)
    }

    override fun dispose() {
        scope.cancel()
        super.dispose()
    }

    /** Paths the user chose to delete, or null when the dialog was cancelled or nothing was picked. */
    fun result(): List<String>? {
        if (!confirmed) return null
        val paths = model.rows.filter { it.selected }.map { it.orphan.path }
        return paths.ifEmpty { null }
    }

    private fun installSelectAllHeader() {
        table.tableHeader.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (table.columnAtPoint(e.point) != COLUMN_CHECK) return
                val all = model.rows.all { it.selected }
                model.rows.forEach { it.selected = !all }
                model.fireTableDataChanged()
            }
        })
        table.tableHeader.defaultRenderer = HeaderRenderer(
            model,
            table.tableHeader.defaultRenderer,
            table.getDefaultRenderer(Boolean::class.javaObjectType),
        )
    }

    /**
     * Makes the trailing icon column a button: click reveals that row's folder, and the pointer turns
     * into a hand over it so it reads as clickable rather than as a decorative cell.
     *
     * The reveal itself is a backend RPC — in split mode the frontend runs on the client machine while
     * the folder lives on the host, so it cannot be done here.
     */
    private fun installReveal() {
        table.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (table.columnAtPoint(e.point) != COLUMN_REVEAL) return
                val row = table.rowAtPoint(e.point).takeIf { it >= 0 } ?: return
                val path = model.rows[row].orphan.path
                scope.launch { service<KiloWorktreeService>().revealPath(path) }
            }
        })
        table.addMouseMotionListener(object : MouseMotionAdapter() {
            override fun mouseMoved(e: MouseEvent) {
                val over = table.columnAtPoint(e.point) == COLUMN_REVEAL && table.rowAtPoint(e.point) >= 0
                table.cursor = Cursor.getPredefinedCursor(if (over) Cursor.HAND_CURSOR else Cursor.DEFAULT_CURSOR)
            }
        })
    }

    private fun syncFooter() {
        val selected = model.rows.filter { it.selected }
        val size = selected.sumOf { it.size ?: 0L }
        val checkouts = selected.count { it.orphan.kind == OrphanKind.BROKEN }
        val base = KiloBundle.message("worktree.orphans.footerSelected", selected.size, StringUtil.formatFileSize(size))
        footer.text = if (checkouts > 0) {
            "$base \u00b7 ${KiloBundle.message("worktree.orphans.footerCheckouts", checkouts)}"
        } else {
            base
        }
        setOKButtonText(deleteLabel())
        isOKActionEnabled = selected.isNotEmpty()
    }

    private fun deleteLabel(): String {
        val selected = model.rows.filter { it.selected }
        val size = selected.sumOf { it.size ?: 0L }
        return KiloBundle.message("worktree.orphans.deleteButton", selected.size, StringUtil.formatFileSize(size))
    }
}

/** Pins a column to [width] so it neither resizes with the dialog nor absorbs slack from its neighbours. */
private fun TableColumn.fix(width: Int) {
    minWidth = width
    maxWidth = width
    preferredWidth = width
    resizable = false
}

private class OrphanRow(val orphan: OrphanDto, var selected: Boolean, var size: Long?)

/** [AbstractTableModel] backing [OrphanDialog]'s table: a boolean selection column plus read-only ones. */
private class OrphanTableModel(val rows: List<OrphanRow>) : AbstractTableModel() {
    override fun getRowCount(): Int = rows.size

    override fun getColumnCount(): Int = 5

    override fun getColumnName(column: Int): String = when (column) {
        COLUMN_PATH -> KiloBundle.message("worktree.orphans.columnPath")
        COLUMN_SIZE -> KiloBundle.message("worktree.orphans.columnSize")
        COLUMN_CONTENTS -> KiloBundle.message("worktree.orphans.columnContents")
        else -> ""
    }

    override fun getColumnClass(column: Int): Class<*> = when (column) {
        COLUMN_CHECK -> Boolean::class.javaObjectType
        COLUMN_REVEAL -> Icon::class.java
        else -> String::class.java
    }

    override fun isCellEditable(row: Int, column: Int): Boolean = column == COLUMN_CHECK

    override fun getValueAt(row: Int, column: Int): Any = when (column) {
        COLUMN_CHECK -> rows[row].selected
        COLUMN_PATH -> rows[row].orphan.path
        COLUMN_SIZE -> rows[row].size?.let { StringUtil.formatFileSize(it) } ?: KiloBundle.message("worktree.orphans.calculating")
        COLUMN_CONTENTS -> if (rows[row].orphan.kind == OrphanKind.BROKEN) KiloBundle.message("worktree.orphans.checkoutWarning") else ""
        COLUMN_REVEAL -> AllIcons.Nodes.Folder
        else -> ""
    }

    override fun setValueAt(value: Any?, row: Int, column: Int) {
        if (column != COLUMN_CHECK || value !is Boolean) return
        rows[row].selected = value
        // Deliberately a cell update rather than a header event: the latter would make JTable rebuild
        // its columns and drop the fixed widths. [OrphanDialog] repaints the header from its listener.
        fireTableCellUpdated(row, column)
    }
}

/** Header renderer for [COLUMN_CHECK] that reads as a select-all box: checked once every row is selected. */
private class HeaderRenderer(
    private val model: OrphanTableModel,
    private val fallback: TableCellRenderer,
    private val check: TableCellRenderer,
) : TableCellRenderer {
    override fun getTableCellRendererComponent(
        table: JTable?,
        value: Any?,
        isSelected: Boolean,
        hasFocus: Boolean,
        row: Int,
        column: Int,
    ): Component {
        if (column != COLUMN_CHECK || table == null) {
            return fallback.getTableCellRendererComponent(table, value, isSelected, hasFocus, row, column)
        }
        val all = model.rows.isNotEmpty() && model.rows.all { it.selected }
        return check.getTableCellRendererComponent(table, all, false, false, row, column)
    }
}
