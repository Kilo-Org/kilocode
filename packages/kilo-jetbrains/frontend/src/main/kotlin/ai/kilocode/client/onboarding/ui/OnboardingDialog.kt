package ai.kilocode.client.onboarding.ui

import ai.kilocode.client.onboarding.OnboardingController
import ai.kilocode.client.onboarding.OnboardingRunState
import ai.kilocode.client.onboarding.OnboardingStep
import ai.kilocode.client.onboarding.OnboardingStepView
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import com.intellij.ide.ui.laf.darcula.ui.DarculaButtonUI
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.util.Disposer
import com.intellij.ui.ColoredListCellRenderer
import com.intellij.ui.CollectionListModel
import com.intellij.ui.JBSplitter
import com.intellij.ui.ScrollingUtil
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBDimension
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import javax.swing.Action
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.ListSelectionModel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Modal dialog that walks the user through every currently detected [OnboardingStep]: a step rail
 * on the left, the selected step's own [OnboardingStepView.component] on the right, and footer
 * buttons (`Later` / `Skip` / `Run` / `Next`) that act on the selected step.
 *
 * Navigation locks while the selected step is [OnboardingRunState.Running] so a half-applied step
 * cannot be abandoned via the rail, Escape, or the window close box.
 */
internal class OnboardingDialog(
    private val controller: OnboardingController,
    initial: List<OnboardingStep>,
    private val onClosed: () -> Unit,
) : DialogWrapper(true) {

    private class Entry(val step: OnboardingStep, val view: OnboardingStepView)

    // ModalityState.any(): this dialog is modal, so plain Dispatchers.EDT work would be queued
    // behind it and never run while it is open — the run-state watchers below would go dead and
    // Run/Next would never update as a step progresses.
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.EDT + ModalityState.any().asContextElement())
    private val entries = linkedMapOf<String, Entry>()
    private val resolved = mutableSetOf<String>()
    private val skipped = mutableSetOf<String>()

    private val listModel = CollectionListModel<String>()

    // internal (not private): lets tests simulate real clicks/selection on the same live
    // components the dialog wires up, instead of adding test-only accessor methods.
    internal val rail = JBList(listModel)
    private val right = JPanel(BorderLayout())

    internal val laterButton = button(KiloBundle.message("onboarding.button.later")) { onLater() }
    internal val skipButton = button(KiloBundle.message("onboarding.button.skip")) { onSkip() }
    internal val runButton = button(KiloBundle.message("onboarding.button.run"), primary = true) { onRun() }
    internal val nextButton = button(KiloBundle.message("onboarding.button.next"), primary = true) { onNext() }

    init {
        title = KiloBundle.message("onboarding.dialog.title")
        initial.forEach { step ->
            val provider = controller.provider(step.id) ?: return@forEach
            entries[step.id] = Entry(step, provider.view())
        }
        listModel.replaceAll(entries.keys.toList())
        init()
        if (entries.isNotEmpty()) rail.selectedIndex = 0
        watchEntries()
        syncSelection()
    }

    override fun createCenterPanel(): JComponent {
        rail.cellRenderer = object : ColoredListCellRenderer<String>() {
            override fun customizeCellRenderer(
                list: JList<out String>,
                value: String,
                index: Int,
                selected: Boolean,
                focused: Boolean,
            ) {
                val entry = entries[value] ?: return
                append(entry.step.need.title)
                append("  ${statusText(value)}", SimpleTextAttributes.GRAYED_ATTRIBUTES)
            }
        }
        rail.selectionMode = ListSelectionModel.SINGLE_SELECTION
        rail.addListSelectionListener { event -> if (!event.valueIsAdjusting) syncSelection() }
        ScrollingUtil.installActions(rail)
        val left = JBScrollPane(rail).apply {
            border = JBUI.Borders.customLineRight(UiStyle.Colors.contentBorder())
            preferredSize = JBDimension(RAIL_WIDTH, DIALOG_HEIGHT)
        }
        right.isOpaque = false
        right.border = JBUI.Borders.empty(UiStyle.Gap.pad())
        return JBSplitter(false, SPLIT_PROPORTION).apply {
            firstComponent = left
            secondComponent = right
            splitterProportionKey = "Kilo.OnboardingDialog.splitter"
            preferredSize = JBDimension(DIALOG_WIDTH, DIALOG_HEIGHT)
        }
    }

    override fun createActions(): Array<Action> = emptyArray()

    override fun createSouthPanel(): JComponent {
        val actions = Stack.horizontal(gap = UiStyle.Gap.sm())
            .next(laterButton)
            .next(skipButton)
            .next(runButton)
            .next(nextButton)
        return JPanel(BorderLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.empty(UiStyle.Gap.pad())
            add(actions, BorderLayout.EAST)
        }
    }

    override fun getPreferredFocusedComponent(): JComponent = rail

    override fun getDimensionServiceKey(): String = "Kilo.OnboardingDialog"

    override fun doCancelAction() {
        if (isSelectedRunning()) return
        super.doCancelAction()
    }

    override fun dispose() {
        entries.values.forEach { (it.view.component as? Disposable)?.let(Disposer::dispose) }
        scope.cancel()
        onClosed()
        super.dispose()
    }

    private fun watchEntries() {
        entries.values.forEach { entry ->
            scope.launch {
                entry.view.run.collect {
                    rail.repaint()
                    if (selectedId() == entry.step.id) syncButtons()
                }
            }
            scope.launch {
                entry.view.ready.collect {
                    if (selectedId() == entry.step.id) syncButtons()
                }
            }
        }
    }

    private fun selectedId(): String? = rail.selectedValue

    private fun selectedEntry(): Entry? = selectedId()?.let(entries::get)

    private fun isSelectedRunning(): Boolean = selectedEntry()?.view?.run?.value is OnboardingRunState.Running

    private fun syncSelection() {
        val entry = selectedEntry() ?: return
        right.removeAll()
        right.add(entry.view.component, BorderLayout.CENTER)
        right.revalidate()
        right.repaint()
        syncButtons()
    }

    private fun syncButtons() {
        val entry = selectedEntry() ?: return
        val runState = entry.view.run.value
        val running = runState is OnboardingRunState.Running
        val doneOrFailed = runState is OnboardingRunState.Done || runState is OnboardingRunState.Failed
        laterButton.isVisible = !running && !doneOrFailed
        skipButton.isVisible = !running && !doneOrFailed
        runButton.isVisible = !doneOrFailed
        runButton.isEnabled = !running && entry.view.ready.value
        runButton.text = if (running) {
            KiloBundle.message("onboarding.button.running")
        } else {
            KiloBundle.message("onboarding.button.run")
        }
        nextButton.isVisible = doneOrFailed
        nextButton.text = if (isLastUnresolved(entry.step.id)) {
            KiloBundle.message("onboarding.button.finish")
        } else {
            KiloBundle.message("onboarding.button.next")
        }
        rail.isEnabled = !running
    }

    private fun isLastUnresolved(id: String): Boolean = entries.keys.none { it != id && it !in resolved }

    private fun onLater() {
        val entry = selectedEntry() ?: return
        controller.laterStep(entry.step.id)
        advance(entry.step.id)
    }

    private fun onSkip() {
        val entry = selectedEntry() ?: return
        controller.skipStep(entry.step.id)
        skipped.add(entry.step.id)
        rail.repaint()
        advance(entry.step.id)
    }

    @RequiresEdt
    private fun onRun() {
        selectedEntry()?.view?.start()
        // Sync immediately rather than waiting for the run-state flow round-trip so the button
        // disables the instant the click is handled, not a dispatch cycle later.
        syncButtons()
    }

    private fun onNext() {
        val entry = selectedEntry() ?: return
        entry.view.done()
        advance(entry.step.id)
    }

    private fun advance(fromId: String) {
        resolved.add(fromId)
        val next = entries.keys.firstOrNull { it !in resolved }
        if (next == null) {
            close(OK_EXIT_CODE)
            return
        }
        rail.setSelectedValue(next, true)
        syncSelection()
    }

    private fun statusText(id: String): String = when {
        id in skipped -> KiloBundle.message("onboarding.status.skipped")
        else -> when (entries[id]?.view?.run?.value) {
            is OnboardingRunState.Running -> KiloBundle.message("onboarding.status.running")
            is OnboardingRunState.Done -> KiloBundle.message("onboarding.status.done")
            is OnboardingRunState.Failed -> KiloBundle.message("onboarding.status.failed")
            else -> KiloBundle.message("onboarding.status.pending")
        }
    }

    private fun button(text: String, primary: Boolean = false, action: () -> Unit): JButton {
        val btn = JButton(text)
        btn.isOpaque = false
        btn.putClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY, if (primary) true else null)
        btn.addActionListener { action() }
        return btn
    }

    private companion object {
        const val RAIL_WIDTH = 220
        const val DIALOG_WIDTH = 760
        const val DIALOG_HEIGHT = 520
        const val SPLIT_PROPORTION = 0.28f
    }
}
