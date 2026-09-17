package ai.kilocode.client.settings.marketplace

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.BaseContentPanel
import ai.kilocode.client.settings.base.SettingsRow
import ai.kilocode.client.settings.base.SettingsRows
import ai.kilocode.client.settings.base.SettingsStackedRow
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.rpc.dto.MarketplaceItemDto
import ai.kilocode.rpc.dto.MarketplaceMethodDto
import ai.kilocode.rpc.dto.MarketplaceParamDto
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.ValidationInfo
import com.intellij.openapi.util.text.HtmlChunk
import com.intellij.ui.EditorNotificationPanel.Status
import com.intellij.ui.InlineBanner
import com.intellij.ui.TitledSeparator
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.event.ComponentAdapter
import java.awt.event.ComponentEvent
import javax.swing.JComponent
import javax.swing.ScrollPaneConstants

internal data class MarketplaceInstallRequest(
    val target: String,
    val parameters: Map<String, String>,
    /** The chosen scope already has the item, so confirming removes it from that scope. */
    val remove: Boolean = false,
)

/**
 * The platform's information banner, carrying copy that re-wraps to the width it is actually given.
 *
 * Swing cannot ask an HTML view "how tall are you at some width you do not have yet", so [seed] is the
 * column the first layout wraps at — that is what the dialog packs around. Once Swing has assigned a
 * real width, the text re-wraps to it, which keeps a resized dialog from leaving a ragged right edge.
 * Re-wrapping is skipped unless the width actually changed, so the resize does not loop.
 */
internal class WrapBanner(private val copy: String, private val seed: Int) :
    InlineBanner("", Status.Info) {
    private var applied = 0

    /** Measured once per banner: chrome cannot change mid-resize, and [chrome] builds a component. */
    private val chrome = chrome()

    init {
        showCloseButton(false)
        wrap(seed)
        addComponentListener(object : ComponentAdapter() {
            override fun componentResized(e: ComponentEvent) = wrap(width - chrome)
        })
    }

    private fun wrap(to: Int) {
        if (to <= 0 || to == applied) return
        applied = to
        setMessage(UiStyle.Text.wrap(copy, to))
    }

    companion object {
        /**
         * Horizontal space a banner spends on itself — insets, icon, the gap after it, and the slot it
         * reserves for its buttons. Measured from an empty banner rather than rebuilt from the platform's
         * constants, so it stays right if any of them change. Callers should hold the result rather than
         * call this per layout pass; it constructs a banner to measure.
         */
        fun chrome(): Int = InlineBanner("", Status.Info).showCloseButton(false).preferredSize.width
    }
}

internal interface MarketplaceInstallDialogHandle {
    fun showAndGet(): Boolean
    fun result(): MarketplaceInstallRequest
}

internal class MarketplaceInstallDialog(
    private val item: MarketplaceItemDto,
    private val hasProjectDirectory: Boolean,
) : DialogWrapper(true), MarketplaceInstallDialogHandle {
    private val scope = combo(scopeOptions()).apply { selectedItem = preferred() }
    private val destination = JBLabel().apply { foreground = UIUtil.getContextHelpForeground() }
    private val method = combo(item.methods.map { it.name }.toTypedArray())
    private val fields = linkedMapOf<String, JBTextField>()
    private val paramsRows = SettingsRows()

    // Install-only parts of the form, hidden for a removal. Declared before [body] on purpose: form()
    // assigns them, and a property initializer running afterwards would reset them to null.
    private var methodRow: JComponent? = null
    private var security: JComponent? = null

    /**
     * The form, built before [init] runs. Declaring it here rather than inside [createCenterPanel]
     * means it is already populated when the platform asks for the north panel, so the header can wrap
     * to the width the form settles on instead of to an arbitrary column.
     */
    private val body = form()
    private var center: JComponent? = null

    init {
        scope.addActionListener { syncAction() }
        method.addActionListener { syncParams() }
        syncDestination()
        syncParams()
        init()
        // After init(), so the OK button exists to be relabelled.
        syncAction()
        initValidation()
        fit()
    }

    internal fun centerComponent(): JComponent = center ?: error("center panel not built")

    /** True when the item is already present in the scope currently chosen, so the action is a removal. */
    internal fun uninstalls(): Boolean =
        if (scope.selectedItem == globalLabel()) item.installedGlobal else item.installedProject

    override fun result(): MarketplaceInstallRequest {
        val target = if (scope.selectedItem == globalLabel()) "global" else "project"
        if (uninstalls()) return MarketplaceInstallRequest(target, emptyMap(), remove = true)
        val params = mutableMapOf<String, String>()
        effectiveParams().forEach { param ->
            val text = fields[param.key]?.text?.trim().orEmpty()
            if (text.isNotEmpty()) params[param.key] = text
        }
        selectedMethod()?.let { params[METHOD_PARAM] = it.name }
        return MarketplaceInstallRequest(target, params)
    }

    private fun form(): JComponent {
        val panel = BaseContentPanel().apply {
            border = JBUI.Borders.empty(UiStyle.Gap.pad())
        }
        SettingsRows().apply {
            row(SettingsRow(
                KiloBundle.message("settings.marketplace.install.scope"),
                KiloBundle.message("settings.marketplace.install.scope.description"),
                scope,
            ))
            row(SettingsRow(
                KiloBundle.message("settings.marketplace.install.destination"),
                value = destination,
            ))
            if (item.methods.size > 1) {
                val pick = SettingsRow(KiloBundle.message("settings.marketplace.install.method"), value = method)
                methodRow = pick
                row(pick)
            }
            panel.next(this)
        }
        if (item.type == "mcp") {
            security = Stack.vertical(UiStyle.Gap.sm())
                .next(TitledSeparator(KiloBundle.message("settings.marketplace.install.security.title")))
                .next(note(KiloBundle.message("settings.marketplace.install.security")))
            panel.next(security!!)
        }
        panel.next(paramsRows)
        return panel
    }

    /**
     * Relabels the dialog for the chosen scope: a scope that already has the item is removed rather
     * than installed. The install-only parts of the form go away with it, since nothing about a
     * parameter or an installation method applies to a removal.
     */
    private fun syncAction() {
        val remove = uninstalls()
        title = KiloBundle.message(
            if (remove) "settings.marketplace.uninstall.title" else "settings.marketplace.install.title",
            item.name,
        )
        setOKButtonText(
            KiloBundle.message(if (remove) "settings.marketplace.uninstall" else "settings.marketplace.install"),
        )
        methodRow?.isVisible = !remove
        security?.isVisible = !remove
        syncDestination()
        syncParams()
    }

    /**
     * The scroll pane is a fallback for a screen too short for the form, not the normal case — [fit]
     * grows the dialog to the content first, so it usually never shows a bar.
     */
    override fun createCenterPanel(): JComponent = JBScrollPane(Stack.vertical().next(body)).apply {
        border = JBUI.Borders.empty()
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
    }.also { center = it }

    /**
     * Item description above the form. The dialog title only names the item, so this is where the
     * catalog blurb goes. It wraps to the width the form already needs, so a long description fills the
     * dialog evenly instead of stopping short of the right edge or stretching the dialog to one line.
     */
    override fun createNorthPanel(): JComponent? {
        val text = item.description.trim()
        if (text.isEmpty()) return null
        return Stack.vertical()
            .next(WrapBanner(text, headerWidth() - WrapBanner.chrome()))
            .apply { border = JBUI.Borders.empty(0, UiStyle.Gap.pad(), UiStyle.Gap.pad(), UiStyle.Gap.pad()) }
    }

    /** The form's own width, floored so a compact form still gives the description a readable column. */
    private fun headerWidth(): Int =
        (body.preferredSize.width - UiStyle.Gap.pad() * 2).coerceAtLeast(UiStyle.Text.bodyWidth())

    /** Grows the dialog to its content so nothing needs scrolling to reach. */
    private fun fit() {
        pack()
    }

    override fun getPreferredFocusedComponent(): JComponent = fields.values.firstOrNull() ?: scope

    // No dimension service key on purpose: a remembered size would win over packing, so an item with
    // more parameters than the last one would open pre-sized too small and scroll.

    override fun doValidateAll(): List<ValidationInfo> = if (uninstalls()) emptyList() else effectiveParams().mapNotNull { param ->
        if (param.optional) return@mapNotNull null
        val field = fields[param.key] ?: return@mapNotNull null
        if (field.text.isNotBlank()) return@mapNotNull null
        ValidationInfo(KiloBundle.message("settings.marketplace.install.param.required"), field)
    }

    private fun selectedMethod(): MarketplaceMethodDto? {
        if (item.methods.size <= 1) return item.methods.firstOrNull()
        val name = method.selectedItem as? String ?: return item.methods.firstOrNull()
        return item.methods.firstOrNull { it.name == name }
    }

    private fun effectiveParams(): List<MarketplaceParamDto> {
        val selected = selectedMethod() ?: return item.parameters
        return selected.parameters.ifEmpty { item.parameters }
    }

    private fun effectivePrerequisites(): List<String> {
        val selected = selectedMethod() ?: return item.prerequisites
        return selected.prerequisites.ifEmpty { item.prerequisites }
    }

    private fun syncDestination() {
        val target = if (scope.selectedItem == globalLabel()) "global" else "project"
        destination.text = destinationText(item.type, target, item.id)
    }

    private fun syncParams() {
        paramsRows.removeAll()
        fields.clear()
        // A removal configures nothing, so it shows neither prerequisites nor parameter inputs.
        if (uninstalls()) {
            paramsRows.revalidate()
            paramsRows.repaint()
            center?.revalidate()
            center?.repaint()
            if (isShowing) fit()
            return
        }
        val prerequisites = effectivePrerequisites()
        if (prerequisites.isNotEmpty()) {
            paramsRows.row(SettingsStackedRow(
                KiloBundle.message("settings.marketplace.install.prerequisites"),
                value = JBLabel(bullets(prerequisites)),
            ))
        }
        for (param in effectiveParams()) {
            val field = JBTextField().apply {
                columns = FIELD_COLUMNS
                emptyText.text = param.placeholder.orEmpty()
            }
            fields[param.key] = field
            paramsRows.row(SettingsRow(param.name, value = field))
        }
        paramsRows.revalidate()
        paramsRows.repaint()
        // Absent until the platform asks for the center panel; the first sync runs before that.
        center?.revalidate()
        center?.repaint()
        if (isShowing) fit()
    }

    private fun scopeOptions(): Array<String> =
        if (hasProjectDirectory) arrayOf(projectLabel(), globalLabel()) else arrayOf(globalLabel())

    /**
     * Opens on a scope the item is missing from, so the row's Install action defaults to installing.
     * Switching to a scope that already has it turns the dialog into an uninstall.
     */
    private fun preferred(): String {
        if (!hasProjectDirectory) return globalLabel()
        if (!item.installedProject) return projectLabel()
        if (!item.installedGlobal) return globalLabel()
        return projectLabel()
    }

    /**
     * A combo sized to its widest entry rather than to whatever happens to be selected, so switching to
     * a longer option does not ellipsize it. Swing sizes to the prototype and stops measuring per item.
     */
    private fun combo(items: Array<String>) = ComboBox(items).apply {
        prototypeDisplayValue = items.maxByOrNull { it.length }
    }

    /** Secondary copy that wraps, so a long note reads as a paragraph instead of widening the dialog. */
    private fun note(text: String) = JBLabel(UiStyle.Text.wrap(text, UiStyle.Text.bodyWidth())).apply {
        foreground = UIUtil.getContextHelpForeground()
        font = UiStyle.Fonts.small()
    }

    /** One item per line, capped to the body column. A plain label would run `\n` items together. */
    private fun bullets(items: List<String>): String = HtmlChunk.div()
        .attr("width", UiStyle.Text.bodyWidth())
        .children(items.map { HtmlChunk.div().addText("\u2022 $it") })
        .wrapWith(HtmlChunk.body())
        .wrapWith("html")
        .toString()

    private companion object {
        const val METHOD_PARAM = "__method"
        const val FIELD_COLUMNS = 32

        fun projectLabel() = KiloBundle.message("settings.marketplace.install.scope.project")
        fun globalLabel() = KiloBundle.message("settings.marketplace.install.scope.global")

        fun destinationText(type: String, target: String, id: String): String = when ("$type:$target") {
            "mcp:global" -> KiloBundle.message("settings.marketplace.install.destination.mcp.global")
            "mcp:project" -> KiloBundle.message("settings.marketplace.install.destination.mcp.project")
            "agent:global" -> KiloBundle.message("settings.marketplace.install.destination.agent.global", id)
            "agent:project" -> KiloBundle.message("settings.marketplace.install.destination.agent.project", id)
            "skill:global" -> KiloBundle.message("settings.marketplace.install.destination.skill.global", id)
            "skill:project" -> KiloBundle.message("settings.marketplace.install.destination.skill.project", id)
            else -> ""
        }
    }
}
