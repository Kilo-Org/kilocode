package ai.kilocode.client.settings.agents

import ai.kilocode.cli.KiloCliParser
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.settings.base.BaseContentPanel
import ai.kilocode.client.settings.base.SettingsRow
import ai.kilocode.client.settings.base.SettingsRows
import ai.kilocode.client.settings.base.SettingsStackedRow
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.rpc.dto.AgentCreateDto
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.ValidationInfo
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.JBDimension
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.Rectangle
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.Scrollable
import javax.swing.ScrollPaneConstants
import javax.swing.SwingConstants

internal interface AgentCreateDialogHandle {
    fun showAndGet(): Boolean
    fun result(): AgentCreateDto
}

internal class AgentCreateDialog(private val names: Collection<String>) : DialogWrapper(true), AgentCreateDialogHandle {
    private val id = JBTextField().apply { columns = ID_COLUMNS }
    private val prompt = PromptField()
    private val mode = ComboBox(arrayOf(KiloCliParser.MODE_PRIMARY, KiloCliParser.MODE_SUBAGENT, KiloCliParser.MODE_ALL)).apply {
        selectedItem = KiloCliParser.MODE_PRIMARY
    }
    private val scope = ComboBox(arrayOf(projectLabel(), globalLabel())).apply {
        selectedItem = projectLabel()
    }
    private val description = JBTextArea().apply {
        rows = 3
        lineWrap = true
        wrapStyleWord = true
        border = JBUI.Borders.empty()
    }
    private var center: JComponent? = null

    init {
        title = KiloBundle.message("settings.agentBehavior.agents.create.title")
        init()
        initValidation()
    }

    internal fun centerComponent(): JComponent = center ?: error("center panel not built")

    override fun result(): AgentCreateDto = AgentCreateDto(
        name = id.text.trim(),
        prompt = prompt.text.trim(),
        mode = mode.selectedItem?.toString() ?: KiloCliParser.MODE_PRIMARY,
        description = description.text.trim().takeIf { it.isNotBlank() },
        scope = when (scope.selectedItem?.toString()) {
            globalLabel() -> "global"
            else -> "project"
        },
    )

    override fun createCenterPanel(): JComponent {
        val panel = BaseContentPanel().apply {
            border = JBUI.Borders.empty(
                UiStyle.Gap.pad(),
                UiStyle.Gap.pad(),
                UiStyle.Gap.pad(),
                UiStyle.Gap.pad() * 2,
            )
        }
        SettingsRows().apply {
            row(SettingsRow(
                KiloBundle.message("settings.agentBehavior.agents.create.name"),
                description = KiloBundle.message("settings.agentBehavior.agents.create.name.description"),
                value = id,
            ))
            row(SettingsRow(
                KiloBundle.message("settings.agentBehavior.agents.create.mode"),
                description = KiloBundle.message("settings.agentBehavior.agents.create.mode.description"),
                value = mode,
            ))
            row(SettingsRow(
                KiloBundle.message("settings.agentBehavior.agents.create.scope"),
                description = KiloBundle.message("settings.agentBehavior.agents.create.scope.description"),
                value = scope,
            ))
            row(SettingsStackedRow(
                KiloBundle.message("settings.agentBehavior.agents.create.description"),
                description = KiloBundle.message("settings.agentBehavior.agents.create.description.description"),
                value = box(description),
            ))
            row(SettingsStackedRow(
                KiloBundle.message("settings.agentBehavior.agents.create.prompt"),
                description = KiloBundle.message("settings.agentBehavior.agents.create.prompt.description"),
                value = box(prompt),
            ))
            panel.next(this)
        }
        val content = ScrollContent().apply {
            add(Stack.vertical().next(panel), BorderLayout.CENTER)
        }
        return JBScrollPane(content).apply {
            border = JBUI.Borders.empty()
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
        }.also { center = it }
    }

    override fun getPreferredFocusedComponent(): JComponent = id

    override fun getDimensionServiceKey(): String = "Kilo.AgentCreateDialog"

    override fun doValidateAll(): List<ValidationInfo> = validateAgentCreate(result(), names).map { err ->
        ValidationInfo(KiloBundle.message(err.key), component(err.field))
    }

    private fun component(field: AgentCreateField): JComponent = when (field) {
        AgentCreateField.NAME -> id
        AgentCreateField.PROMPT -> prompt
        AgentCreateField.MODE -> mode
        AgentCreateField.SCOPE -> scope
    }

    private fun box(area: JBTextArea) = JBScrollPane(area).apply { viewportBorder = createEditorPad() }

    private fun box(field: PromptField) = JBScrollPane(field).apply {
        viewportBorder = createEditorPad()
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
    }

    private class PromptField : EditorTextField(
        EditorFactory.getInstance().createDocument(""),
        ProjectManager.getInstance().defaultProject,
        PlainTextFileType.INSTANCE,
        false,
        false,
    ) {
        init {
            border = JBUI.Borders.empty()
            setOneLineMode(false)
            setPlaceholder(KiloBundle.message("settings.agentBehavior.agents.create.prompt.placeholder"))
            setShowPlaceholderWhenFocused(true)
            val height = getFontMetrics(font).height * PROMPT_ROWS + JBUI.scale(PROMPT_CHROME)
            minimumSize = JBDimension(0, height)
            preferredSize = JBDimension(0, height)
            addSettingsProvider { ed ->
                ed.setBorder(JBUI.Borders.empty())
                ed.scrollPane.border = JBUI.Borders.empty()
                ed.scrollPane.viewportBorder = JBUI.Borders.empty()
                ed.settings.isUseSoftWraps = true
                ed.settings.isPaintSoftWraps = false
                ed.settings.isAdditionalPageAtBottom = false
                ed.scrollPane.horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
                ed.scrollPane.verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
            }
        }
    }

    private class ScrollContent : JPanel(BorderLayout()), Scrollable {
        override fun getPreferredScrollableViewportSize(): Dimension = preferredSize

        override fun getScrollableUnitIncrement(visibleRect: Rectangle, orientation: Int, direction: Int): Int = UiStyle.Gap.pad()

        override fun getScrollableBlockIncrement(visibleRect: Rectangle, orientation: Int, direction: Int): Int {
            if (orientation == SwingConstants.VERTICAL) return (visibleRect.height - UiStyle.Gap.pad()).coerceAtLeast(UiStyle.Gap.pad())
            return (visibleRect.width - UiStyle.Gap.pad()).coerceAtLeast(UiStyle.Gap.pad())
        }

        override fun getScrollableTracksViewportWidth(): Boolean = true

        override fun getScrollableTracksViewportHeight(): Boolean = false
    }

    private companion object {
        const val ID_COLUMNS = 50
        const val PROMPT_ROWS = 8
        const val PROMPT_CHROME = 24
    }
}

private fun projectLabel() = KiloBundle.message("settings.agentBehavior.agents.create.scope.project")

private fun globalLabel() = KiloBundle.message("settings.agentBehavior.agents.create.scope.global")

private fun createEditorPad() = JBUI.Borders.empty(
    JBUI.scale(SessionUiStyle.View.Prompt.SHELL_VERTICAL_PADDING),
    JBUI.scale(SessionUiStyle.View.Prompt.SHELL_HORIZONTAL_PADDING),
    JBUI.scale(SessionUiStyle.View.Prompt.SHELL_VERTICAL_PADDING),
    JBUI.scale(SessionUiStyle.View.Prompt.SHELL_HORIZONTAL_PADDING),
)
