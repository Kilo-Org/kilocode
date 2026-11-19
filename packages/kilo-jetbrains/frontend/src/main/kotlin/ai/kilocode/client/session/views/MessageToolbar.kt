package ai.kilocode.client.session.views

import ai.kilocode.client.session.ui.selection.SessionCopyButton
import ai.kilocode.client.ui.ToolbarButtonAction
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.toolbarButton
import com.intellij.icons.AllIcons
import ai.kilocode.client.plugin.KiloBundle
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.Dimension
import java.awt.FlowLayout
import java.awt.image.BufferedImage
import javax.swing.JComponent
import javax.swing.JPanel

internal class MessageToolbar(
    text: () -> String?,
    image: () -> BufferedImage? = { null },
    actions: List<ToolbarButtonAction> = emptyList(),
    tooltip: String = KiloBundle.message("session.copy.hover"),
) : JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)) {
    /** The hover toolbar of a user prompt bubble: fork this message, roll back to it, copy it. */
    constructor(text: () -> String?, revert: (() -> Unit)?, fork: (() -> Unit)? = null) : this(
        text,
        actions = listOfNotNull(
            fork?.let { ToolbarButtonAction(AllIcons.Vcs.Branch, KiloBundle.message("session.fork.message"), it) },
            revert?.let { ToolbarButtonAction(AllIcons.Actions.Rollback, KiloBundle.message("revert.message.rollback"), it) },
        ),
        tooltip = KiloBundle.message("session.copy.prompt"),
    )

    private val copy = SessionCopyButton(text = text, image = image, tooltip = tooltip)
    private val button = copy.button
    private val buttons = actions.map(::toolbarButton)
    private val row = Stack.horizontal(UiStyle.Gap.xs()).apply {
        buttons.forEach { next(it) }
        next(button)
    }

    init {
        isOpaque = false
        add(row)
    }

    @RequiresEdt
    fun sync(value: Boolean) {
        if (isVisible == value && button.isEnabled == value) return
        isVisible = value
        button.isEnabled = value
        buttons.forEach { it.isEnabled = value }
        revalidate()
        repaint()
    }

    @RequiresEdt
    fun setActive(value: Boolean) {
        sync(value)
    }

    @RequiresEdt
    fun active() = isVisible && button.isEnabled

    @RequiresEdt
    fun copyButton() = button

    fun placeholder(): JComponent = object : JPanel() {
        init {
            isOpaque = false
        }

        override fun getPreferredSize(): Dimension = dim(this@MessageToolbar.preferredSize)

        override fun getMinimumSize(): Dimension = dim(this@MessageToolbar.minimumSize)

        override fun getMaximumSize(): Dimension = dim(this@MessageToolbar.maximumSize)

        private fun dim(size: Dimension) = Dimension(size.width, size.height + UiStyle.Gap.xs())
    }

    override fun removeNotify() {
        copy.dismiss()
        super.removeNotify()
    }
}
