package ai.kilocode.client.settings.base

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.list.ActiveListSelection
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.KiloAppStatusDto
import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonShortcuts
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.actionSystem.Separator
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.components.service
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.ui.DocumentAdapter
import com.intellij.ui.SearchTextField
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.withContext
import java.awt.BorderLayout
import java.awt.event.KeyEvent
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.KeyStroke
import javax.swing.event.DocumentEvent

private val edt = Dispatchers.EDT + ModalityState.any().asContextElement()

internal abstract class SettingsListPanel(
    private val cs: CoroutineScope,
    cfg: SettingsListConfig = SettingsListConfig.Equal,
) : SettingsPanel(), Disposable {
    private val search = SearchTextField(false)
    protected val view = SettingsListView(KiloBundle.message("settings.agentBehavior.empty"), cfg) { key, id ->
        onCell(key, id)
    }
    private var job: Job? = null
    private var request = 0
    private var disposed = false
    private var pending = false
    protected var busy = false
        private set

    @RequiresEdt
    protected fun start() {
        checkEdt()
        search.textEditor.emptyText.text = searchPlaceholder()
        view.setEmptyText(emptyText())
        setHeader(header())
        setContent(view)
    }

    @RequiresEdt
    open fun reload() {
        checkEdt()
        pending = false
        if (!reload(ActiveListSelection.Preserve)) return
        showProgress(loadingText())
    }

    @RequiresEdt
    fun deferInitialReload() {
        checkEdt()
        pending = true
    }

    @RequiresEdt
    fun hasPendingInitialReload(): Boolean {
        checkEdt()
        return pending
    }

    @RequiresEdt
    protected fun mutateAndReload(
        selection: SettingsListSelection = ActiveListSelection.Preserve,
        text: String = loadingText(),
        block: suspend () -> Boolean,
    ) = mutateAndReload({ selection }, text, block)

    @RequiresEdt
    protected fun mutateAndReload(
        selection: suspend () -> SettingsListSelection,
        text: String = loadingText(),
        block: suspend () -> Boolean,
    ) {
        checkEdt()
        if (!launch("mutation") { id ->
            val changed = block()
            if (!changed) {
                finish(id)
                return@launch
            }
            waitForReady()
            val items = fetch()
            apply(id, items, selection())
        }) return
        showProgress(text)
    }

    protected abstract suspend fun fetch(): List<SettingsListItem>

    protected abstract fun onCell(key: String, cellId: String)

    protected open fun extraActions(): List<AnAction> = emptyList()

    protected open fun toolbarRight(): JComponent? = null

    protected open fun headerExtras(): JComponent? = null

    protected open fun searchPlaceholder(): String = ""

    protected open fun emptyText(): String = KiloBundle.message("settings.agentBehavior.empty")

    protected open fun loadingText(): String = KiloBundle.message("settings.agentBehavior.loading")

    protected open fun showRefresh(): Boolean = true

    protected open fun afterApply() = Unit

    @RequiresEdt
    protected fun selectionIndex(): SettingsListSelection {
        checkEdt()
        return ActiveListSelection.Index(view.selectedIndex())
    }

    private fun header(): JComponent {
        search.textEditor.registerKeyboardAction(
            { view.primary() },
            KeyStroke.getKeyStroke(KeyEvent.VK_ENTER, 0),
            JComponent.WHEN_FOCUSED,
        )
        search.textEditor.registerKeyboardAction(
            { view.move(-1) },
            KeyStroke.getKeyStroke(KeyEvent.VK_UP, 0),
            JComponent.WHEN_FOCUSED,
        )
        search.textEditor.registerKeyboardAction(
            { view.move(1) },
            KeyStroke.getKeyStroke(KeyEvent.VK_DOWN, 0),
            JComponent.WHEN_FOCUSED,
        )
        search.textEditor.document.addDocumentListener(object : DocumentAdapter() {
            override fun textChanged(e: DocumentEvent) {
                view.filter(search.text)
            }
        })
        val stack = Stack.vertical(UiStyle.Gap.sm()).next(toolbarRow())
        headerExtras()?.let { stack.next(it) }
        return stack.next(search)
    }

    private fun toolbarRow(): JComponent {
        val row = JPanel(BorderLayout())
        UiStyle.Components.transparent(row)
        row.add(toolbar(), BorderLayout.WEST)
        toolbarRight()?.let { row.add(it, BorderLayout.EAST) }
        return row
    }

    private fun toolbar(): JComponent {
        val actions = mutableListOf<AnAction>()
        actions += extraActions()
        if (showRefresh()) {
            if (actions.isNotEmpty()) actions += Separator.getInstance()
            actions += SettingsToolbarAction(
                KiloBundle.message("settings.agentBehavior.refresh"),
                KiloBundle.message("settings.agentBehavior.refresh.description"),
                AllIcons.Actions.Refresh,
                { !busy },
            ) { reload() }
        }
        actions.firstOrNull()?.registerCustomShortcutSet(CommonShortcuts.getNewForDialogs(), this)
        ActionManager.getInstance().getAction("Refresh")?.shortcutSet?.let { set ->
            actions.filterIsInstance<SettingsToolbarAction>().lastOrNull()?.registerCustomShortcutSet(set, this)
        }
        val toolbar = ActionManager.getInstance().createActionToolbar(ActionPlaces.TOOLBAR, DefaultActionGroup(actions), true)
        toolbar.targetComponent = this
        toolbar.updateActionsImmediately()
        return toolbar.component
    }

    @RequiresEdt
    protected fun launch(name: String, block: suspend (Int) -> Unit): Boolean {
        checkEdt()
        if (busy || disposed) return false
        val id = ++request
        setBusy(true)
        job = cs.launch {
            try {
                block(id)
            } catch (e: TimeoutCancellationException) {
                LOG.warn("settings list $name timed out", e)
                withContext(edt) {
                    if (!active(id)) return@withContext
                    setBusy(false)
                    showError("${e::class.simpleName}: ${e.message}")
                }
            } catch (e: SettingsMessageException) {
                withContext(edt) {
                    if (!active(id)) return@withContext
                    setBusy(false)
                    showError(e.message.orEmpty())
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                LOG.warn("settings list $name failed", e)
                withContext(edt) {
                    if (!active(id)) return@withContext
                    setBusy(false)
                    showError("${e::class.simpleName}: ${e.message}")
                }
            }
        }
        return true
    }

    @RequiresEdt
    private fun reload(selection: SettingsListSelection): Boolean {
        checkEdt()
        return launch("reload") { id ->
            val items = fetch()
            apply(id, items, selection)
        }
    }

    private suspend fun apply(id: Int, items: List<SettingsListItem>, selection: SettingsListSelection) {
        withContext(edt) {
            if (!active(id)) return@withContext
            setBusy(false)
            view.update(items, selection)
            afterApply()
            clearProgress()
        }
    }

    private suspend fun finish(id: Int) {
        withContext(edt) {
            if (!active(id)) return@withContext
            setBusy(false)
            clearProgress()
        }
    }

    protected suspend fun waitForReady() {
        val flow = service<KiloAppService>().state
        val saw = withTimeoutOrNull(RELOAD_START_TIMEOUT_MS) {
            flow.first { it.status != KiloAppStatusDto.READY }
        } != null
        if (!saw) return
        withTimeout(RELOAD_READY_TIMEOUT_MS) {
            flow.first { it.status == KiloAppStatusDto.READY }
        }
    }

    @RequiresEdt
    protected fun setBusy(value: Boolean) {
        checkEdt()
        if (busy == value) return
        busy = value
        search.isEnabled = !value
        search.textEditor.isEnabled = !value
        view.setBusy(value)
    }

    @RequiresEdt
    override fun dispose() {
        checkEdt()
        disposed = true
        request++
        job?.cancel()
        job = null
        setBusy(false)
    }

    @RequiresEdt
    protected fun active(id: Int): Boolean {
        checkEdt()
        return !disposed && id == request
    }

    protected fun checkEdt() {
        check(ApplicationManager.getApplication().isDispatchThread) { "Settings list panel updates must run on EDT" }
    }

    private companion object {
        val LOG = KiloLog.create(SettingsListPanel::class.java)
        const val RELOAD_START_TIMEOUT_MS = 500L
        const val RELOAD_READY_TIMEOUT_MS = 10_000L
    }
}

internal class SettingsMessageException(message: String) : RuntimeException(message)

internal class SettingsToolbarAction(
    text: String,
    description: String,
    icon: Icon,
    private val enabled: () -> Boolean,
    private val action: () -> Unit,
) : DumbAwareAction(text, description, icon) {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT

    override fun actionPerformed(e: AnActionEvent) {
        if (!enabled()) return
        action()
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = enabled()
    }
}
