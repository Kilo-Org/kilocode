package ai.kilocode.client.settings.agents

import ai.kilocode.cli.KiloCliParser
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.ui.model.ModelPicker
import ai.kilocode.client.settings.base.BaseContentPanel
import ai.kilocode.client.settings.base.SettingsRow
import ai.kilocode.client.settings.base.SettingsStackedRow
import ai.kilocode.client.settings.base.SettingsToggle
import ai.kilocode.client.settings.base.SettingsRows
import ai.kilocode.client.settings.models.ModelSettingPicker
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.HoverIcon
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import com.intellij.icons.AllIcons
import com.intellij.notification.Notification
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.fileChooser.FileChooserFactory
import com.intellij.openapi.fileChooser.FileSaverDescriptor
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.ValidationInfo
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBLabel
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
import javax.swing.text.AbstractDocument
import javax.swing.text.AttributeSet
import javax.swing.text.DocumentFilter

internal class AgentEditDialog(
    private val agent: AgentEditDraft,
    app: KiloAppService,
    items: List<ModelPicker.Item>,
) : DialogWrapper(true) {
    private val description = JBTextArea(agent.description.orEmpty()).apply {
        rows = 3
        lineWrap = true
        wrapStyleWord = true
        isEditable = canEditDescription(agent)
        border = JBUI.Borders.empty()
    }
    private val prompt = PromptField(agent.prompt.orEmpty())
    private var selected = agent.model
    private val model = ModelSettingPicker().apply {
        picker.emptyText = KiloBundle.message("settings.agentBehavior.agents.edit.default")
        picker.placement = ModelPicker.Placement.BELOW
        picker.favorites = { app.favorites.value }
        picker.onFavoriteToggle = { app.toggleModelFavorite(it.provider, it.id) }
        picker.onSelect = { selected = it.key }
        picker.onClear = { selected = null }
        setItems(items, agent.model)
    }
    private val variant = NumericField(agent.variant.orEmpty(), decimal = true)
    private val mode = ComboBox(arrayOf(KiloCliParser.MODE_PRIMARY, KiloCliParser.MODE_SUBAGENT, KiloCliParser.MODE_ALL)).apply {
        selectedItem = agent.mode
        isEnabled = canEditMode(agent)
    }
    private val temperature = NumericField(agent.temperature?.toString().orEmpty(), decimal = true)
    private val top = NumericField(agent.topP?.toString().orEmpty(), decimal = true)
    private val steps = NumericField(agent.steps?.toString().orEmpty(), decimal = false)
    private var hidden = agent.hidden
    private var disabled = agent.disable
    private var center: JComponent? = null

    init {
        title = KiloBundle.message("settings.agentBehavior.agents.edit.title", agent.displayName ?: agent.name)
        init()
        initValidation()
    }

    internal fun centerComponent(): JComponent = center ?: error("center panel not built")

    fun result(): AgentEditDraft = agent.copy(
        description = text(description.text),
        prompt = text(prompt.text),
        model = selected,
        variant = text(variant.text),
        mode = mode.selectedItem?.toString() ?: agent.mode,
        hidden = hidden,
        disable = disabled,
        temperature = number(temperature.text),
        topP = number(top.text),
        steps = integer(steps.text),
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
            row(SettingsStackedRow(
                KiloBundle.message("settings.agentBehavior.agents.edit.name"),
                value = identity(),
                action = exportButton().takeIf { !agent.native },
            ))
            row(SettingsRow(
                KiloBundle.message("settings.agentBehavior.agents.edit.mode"),
                KiloBundle.message("settings.agentBehavior.agents.edit.mode.description"),
                mode,
            ))
            panel.next(this)
        }
        SettingsRows().apply {
            row(SettingsStackedRow(
                KiloBundle.message("settings.agentBehavior.agents.edit.description"),
                if (canEditDescription(agent)) {
                    KiloBundle.message("settings.agentBehavior.agents.edit.description.description")
                } else {
                    KiloBundle.message("settings.agentBehavior.agents.edit.description.native.description")
                },
                scroll(description),
            ))
            row(SettingsStackedRow(
                if (agent.native) {
                    KiloBundle.message("settings.agentBehavior.agents.edit.prompt.native")
                } else {
                    KiloBundle.message("settings.agentBehavior.agents.edit.prompt")
                },
                if (agent.native) {
                    KiloBundle.message("settings.agentBehavior.agents.edit.prompt.native.description")
                } else {
                    KiloBundle.message("settings.agentBehavior.agents.edit.prompt.description")
                },
                scroll(prompt),
            ))
            panel.next(this)
        }
        panel.section(KiloBundle.message("settings.agentBehavior.agents.edit.model")).apply {
            row(SettingsRow(
                KiloBundle.message("settings.agentBehavior.agents.edit.model.override"),
                KiloBundle.message("settings.agentBehavior.agents.edit.model.override.description"),
                model,
            ))
            row(SettingsRow(
                KiloBundle.message("settings.agentBehavior.agents.edit.variant"),
                KiloBundle.message("settings.agentBehavior.agents.edit.variant.description"),
                variant,
            ))
            row(SettingsRow(
                KiloBundle.message("settings.agentBehavior.agents.edit.temperature"),
                KiloBundle.message("settings.agentBehavior.agents.edit.temperature.description"),
                temperature,
            ))
            row(SettingsRow(
                KiloBundle.message("settings.agentBehavior.agents.edit.topP"),
                KiloBundle.message("settings.agentBehavior.agents.edit.topP.description"),
                top,
            ))
            row(SettingsRow(
                KiloBundle.message("settings.agentBehavior.agents.edit.steps"),
                KiloBundle.message("settings.agentBehavior.agents.edit.steps.description"),
                steps,
            ))
        }
        if (canEditVisibility(agent)) panel.section(KiloBundle.message("settings.agentBehavior.agents.edit.visibility")).apply {
            row(SettingsRow(
                KiloBundle.message("settings.agentBehavior.agents.edit.hidden"),
                KiloBundle.message("settings.agentBehavior.agents.edit.hidden.description"),
                SettingsToggle(hidden) { hidden = it },
            ))
            row(SettingsRow(
                KiloBundle.message("settings.agentBehavior.agents.edit.disabled"),
                KiloBundle.message("settings.agentBehavior.agents.edit.disabled.description"),
                SettingsToggle(disabled) { disabled = it },
            ))
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

    override fun getPreferredFocusedComponent(): JComponent = description

    override fun getDimensionServiceKey(): String = "Kilo.AgentEditDialog"

    override fun doValidateAll(): List<ValidationInfo> = listOfNotNull(
        validateMode(),
        validateNumber(temperature, "settings.agentBehavior.agents.edit.temperature.invalid", min = 0.0),
        validateNumber(top, "settings.agentBehavior.agents.edit.topP.invalid", min = 0.0, max = 1.0),
        validateSteps(),
    )

    private fun validateMode(): ValidationInfo? {
        val value = mode.selectedItem?.toString()
        if (value == KiloCliParser.MODE_PRIMARY || value == KiloCliParser.MODE_SUBAGENT || value == KiloCliParser.MODE_ALL) return null
        return ValidationInfo(KiloBundle.message("settings.agentBehavior.agents.edit.mode.invalid"), mode)
    }

    private fun validateNumber(field: NumericField, key: String, min: Double? = null, max: Double? = null): ValidationInfo? {
        val value = field.text.trim()
        if (value.isBlank()) return null
        val parsed = value.toDoubleOrNull()
        if (parsed == null || !parsed.isFinite()) return ValidationInfo(KiloBundle.message(key), field)
        if (min != null && parsed < min) return ValidationInfo(KiloBundle.message(key), field)
        if (max != null && parsed > max) return ValidationInfo(KiloBundle.message(key), field)
        return null
    }

    private fun validateSteps(): ValidationInfo? {
        val value = steps.text.trim()
        if (value.isBlank()) return null
        val parsed = value.toLongOrNull()
        if (parsed != null && parsed > 0) return null
        return ValidationInfo(KiloBundle.message("settings.agentBehavior.agents.edit.steps.invalid"), steps)
    }

    private class NumericField(value: String, decimal: Boolean) : JBTextField(value) {
        init {
            columns = NUMERIC_COLUMNS
            emptyText.text = KiloBundle.message("settings.agentBehavior.agents.edit.default")
            (document as AbstractDocument).documentFilter = NumericFilter(decimal)
        }
    }

    private class NumericFilter(private val decimal: Boolean) : DocumentFilter() {
        override fun insertString(fb: FilterBypass, offset: Int, string: String?, attr: AttributeSet?) {
            replace(fb, offset, 0, string, attr)
        }

        override fun replace(fb: FilterBypass, offset: Int, length: Int, text: String?, attrs: AttributeSet?) {
            val value = text ?: ""
            val next = StringBuilder(fb.document.getText(0, fb.document.length))
                .replace(offset, offset + length, value)
                .toString()
            if (next.isEmpty() || valid(next)) super.replace(fb, offset, length, value, attrs)
        }

        private fun valid(value: String): Boolean {
            if (!decimal) return value.all(Char::isDigit)
            if (value.count { it == '.' } > 1) return false
            return value.all { it.isDigit() || it == '.' }
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

    private fun scroll(area: JBTextArea) = JBScrollPane(area).apply {
        viewportBorder = editorPad()
    }

    private fun scroll(field: PromptField) = JBScrollPane(field).apply {
        viewportBorder = editorPad()
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
    }

    private fun identity(): JComponent {
        val badges = listOfNotNull(
            badge(
                KiloBundle.message("settings.agentBehavior.badge.subagent"),
                UiStyle.Badge.Primary,
            ).takeIf { KiloCliParser.isSubagent(agent.mode) },
            badge(
                KiloBundle.message("settings.agentBehavior.badge.custom"),
                UiStyle.Badge.Primary,
            ).takeIf { canDelete(agent) },
            badge(KiloBundle.message("settings.agentBehavior.badge.hidden")).takeIf { agent.hidden },
            badge(KiloBundle.message("settings.agentBehavior.badge.disabled")).takeIf { agent.disable },
            badge(
                KiloBundle.message("settings.agentBehavior.badge.deprecated"),
                UiStyle.Badge.Alert,
            ).takeIf { agent.deprecated },
        )
        return Stack.horizontal(UiStyle.Gap.xs())
            .next(JBLabel(agent.name))
            .also { row -> badges.forEach(row::next) }
    }

    private fun exportButton() = HoverIcon().apply {
        icon = AllIcons.Actions.Download
        val text = KiloBundle.message("settings.agentBehavior.agents.edit.export")
        toolTipText = text
        accessibleContext.accessibleName = text
        addActionListener { export() }
    }

    private fun export() {
        val file = "${agent.name}.agent.json"
        val descriptor = FileSaverDescriptor(
            KiloBundle.message("settings.agentBehavior.agents.edit.export.title"),
            KiloBundle.message("settings.agentBehavior.agents.edit.export.description"),
            "agent.json",
        )
        val wrapper = FileChooserFactory.getInstance()
            .createSaveFileDialog(descriptor, centerComponent())
            .save(null as VirtualFile?, file) ?: return
        val json = buildAgentExport(result())
        ApplicationManager.getApplication().executeOnPooledThread {
            runCatching {
                wrapper.file.writeText(json, Charsets.UTF_8)
            }.onSuccess {
                notify(NotificationType.INFORMATION, KiloBundle.message("settings.agentBehavior.agents.edit.export.success", wrapper.file.name))
            }.onFailure { err ->
                notify(NotificationType.ERROR, KiloBundle.message("settings.agentBehavior.agents.edit.export.failed"), err.message)
            }
        }
    }

    private fun notify(type: NotificationType, title: String, content: String? = null) {
        ApplicationManager.getApplication().invokeLater {
            val notification = NotificationGroupManager.getInstance()
                .getNotificationGroup("Kilo Code")
                ?.createNotification(title, content.orEmpty(), type)
                ?: Notification("Kilo Code", title, content.orEmpty(), type)
            notification.notify(ProjectManager.getInstance().openProjects.firstOrNull { !it.isDefault })
        }
    }

    private fun badge(text: String, style: UiStyle.Badge.Style = UiStyle.Badge.Secondary) = JBLabel().apply {
        border = JBUI.Borders.emptyLeft(JBUI.CurrentTheme.ActionsList.elementIconGap())
        icon = FilledBadgeIcon(text, style)
    }

    private fun text(value: String): String? = value.trim().takeIf { it.isNotBlank() }

    private fun number(value: String): Double? = text(value)?.toDoubleOrNull()

    private fun integer(value: String): Long? = text(value)?.toLongOrNull()

    private class PromptField(value: String) : EditorTextField(
        EditorFactory.getInstance().createDocument(value),
        ProjectManager.getInstance().defaultProject,
        PlainTextFileType.INSTANCE,
        false,
        false,
    ) {
        init {
            border = JBUI.Borders.empty()
            setOneLineMode(false)
            setPlaceholder(KiloBundle.message("settings.agentBehavior.agents.edit.prompt.placeholder"))
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
}

private fun editorPad() = JBUI.Borders.empty(
    JBUI.scale(SessionUiStyle.View.Prompt.SHELL_VERTICAL_PADDING),
    JBUI.scale(SessionUiStyle.View.Prompt.SHELL_HORIZONTAL_PADDING),
    JBUI.scale(SessionUiStyle.View.Prompt.SHELL_VERTICAL_PADDING),
    JBUI.scale(SessionUiStyle.View.Prompt.SHELL_HORIZONTAL_PADDING),
)

private const val NUMERIC_COLUMNS = 15
private const val PROMPT_ROWS = 8
private const val PROMPT_CHROME = 24
