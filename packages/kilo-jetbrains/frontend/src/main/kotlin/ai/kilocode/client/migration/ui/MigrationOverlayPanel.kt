package ai.kilocode.client.migration.ui

import ai.kilocode.client.migration.MigrationUiSelections
import ai.kilocode.client.migration.MigrationUiState
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.HAlign
import ai.kilocode.client.ui.layout.VAlign
import ai.kilocode.client.ui.layout.align
import com.intellij.ui.components.JBPanel
import com.intellij.util.concurrency.annotations.RequiresEdt
import java.awt.BorderLayout
import javax.swing.JComponent

/**
 * Outer container for the migration wizard rendered inside the blocker layer.
 *
 * Wraps [MigrationWizardPanel] in the blocker layer.
 * Build once; call [update] on every state change.
 */
class MigrationOverlayPanel : JBPanel<MigrationOverlayPanel>(BorderLayout()) {

    private val wizard = MigrationWizardPanel()

    var onSkip: (() -> Unit)?
        get() = wizard.onSkip
        set(v) { wizard.onSkip = v }

    var onStart: ((MigrationUiSelections) -> Unit)?
        get() = wizard.onStart
        set(v) { wizard.onStart = v }

    var onDone: (() -> Unit)?
        get() = wizard.onDone
        set(v) { wizard.onDone = v }

    var onContinueFromError: (() -> Unit)?
        get() = wizard.onContinueFromError
        set(v) { wizard.onContinueFromError = v }

    init {
        withBackground(UiStyle.Colors.bg())
        add(wizard.align(HAlign.CENTER, VAlign.CENTER), BorderLayout.CENTER)
    }

    @RequiresEdt
    fun update(state: MigrationUiState.Needed) {
        wizard.update(state)
        revalidate()
        repaint()
    }

    @RequiresEdt
    fun preferredFocusComponent(): JComponent = wizard.preferredFocusComponent()
}
