package ai.kilocode.client.settings.base

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.settings.profile.UserProfileConfigurable
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.ModelStateDto
import com.intellij.ide.DataManager
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.EDT
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.asContextElement
import com.intellij.openapi.components.service
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.options.ConfigurableWithId
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.options.ex.Settings
import com.intellij.openapi.project.ProjectManager
import com.intellij.util.concurrency.annotations.RequiresBackgroundThread
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.function.Predicate
import javax.swing.JComponent

internal abstract class BaseSettingsUi<C : BaseContentPanel, D, P, R, W>(
    protected val scope: CoroutineScope,
    initial: D,
    private val app: KiloAppService = service(),
    private val workspaces: KiloWorkspaceService = service(),
    private val hint: String? = null,
    private val loginBanner: Boolean = true,
) : SettingsPanel() {
    protected lateinit var form: C
        private set
    protected val jobs = mutableListOf<Job>()
    protected var draft = initial
    protected val saving get() = save
    protected val saveError get() = error
    protected var appState: KiloAppStateDto = app.state.value
        private set
    protected var modelState: ModelStateDto = app.models.value
        private set
    protected var projectDirectory: String? = null
        private set
    protected val hasProjectDirectory get() = projectDirectory != null || hint != null
    protected var workspaceLoading = false
        private set
    protected var workspaceLoaded = false
        private set

    private var baseline = initial
    private var pending: D? = null
    private var save = false
    private var error: String? = null
    private var disposed = false

    @RequiresEdt
    protected fun startSettings(content: C) {
        form = content
        setContent(content)
        syncContent()
        start()
    }

    private fun start() {
        jobs += scope.launch {
            app.state.collect { state -> withContext(edt) { updateApp(state) } }
        }
        jobs += scope.launch {
            app.models.collect { state -> withContext(edt) { updateModels(state) } }
        }
        jobs += scope.launch { app.connect() }
        val path = hint ?: return
        jobs += scope.launch {
            val dir = workspaces.resolveProjectDirectory(path)
            withContext(edt) {
                projectDirectory = dir
                workspaceLoaded = false
                syncContent()
                load()
            }
        }
    }

    @RequiresEdt
    private fun updateApp(state: KiloAppStateDto) {
        appState = state
        if (state.status != KiloAppStatusDto.READY) {
            workspaceLoading = false
            unavailable(state)
            syncContent()
            return
        }
        acceptBase(draft(state))
        syncContent()
        load()
    }

    @RequiresEdt
    private fun updateModels(state: ModelStateDto) {
        modelState = state
        models(state)
        syncContent()
    }

    @RequiresEdt
    private fun load() {
        val root = projectDirectory ?: return
        if (appState.status != KiloAppStatusDto.READY || workspaceLoading || workspaceLoaded) return
        workspaceLoading = true
        clearWorkspaceError()
        syncContent()
        jobs += scope.launch {
            val state = loadWorkspace(root)
            withContext(edt) {
                applyWorkspace(state)
                workspaceLoaded = true
                workspaceLoading = false
                acceptBase(draft(appState))
                syncContent()
            }
        }
    }

    @RequiresEdt
    fun modified(): Boolean {
        checkEdt()
        return draft != (pending ?: baseline)
    }

    @RequiresEdt
    fun resetDraft() {
        checkEdt()
        draft = pending ?: baseline
        error = null
        if (!save) clearProgress()
        syncContent()
    }

    @RequiresEdt
    fun applyDraft() {
        checkEdt()
        val prev = baseline
        val next = draft
        val change = change(prev, next) ?: return
        logSaveStarted(change)
        pending = next
        save = true
        error = null
        showProgress(pendingText())
        syncContent()
        save(change) { result ->
            ApplicationManager.getApplication().invokeLater({
                if (disposed) {
                    if (result == null) {
                        logSaveFailedAfterDispose(change)
                        onSaveFailedAfterDispose(change)
                    } else {
                        logSaveCompletedAfterDispose(change)
                    }
                    return@invokeLater
                }
                if (result != null) {
                    logSaveCompleted(change)
                    val edit = draft
                    val base = base(result)
                    baseline = if (saved(base, next)) base else next
                    draft = if (edit == next) baseline else edit
                    pending = null
                    save = false
                    error = null
                    clearProgress()
                    syncContent()
                    return@invokeLater
                }
                val edit = draft
                baseline = prev
                draft = if (edit == next) next else edit
                pending = null
                save = false
                error = failedText()
                logSaveFailed(change)
                syncContent()
            }, ModalityState.any())
        }
    }

    @RequiresEdt
    fun dispose() {
        checkEdt()
        disposed = true
        jobs.forEach { it.cancel() }
        jobs.clear()
        scope.cancel()
    }

    @RequiresEdt
    protected fun updateDraft(fn: D.() -> D) {
        checkEdt()
        draft = draft.fn()
        error = null
        syncContent()
    }

    @RequiresEdt
    protected fun acceptBase(base: D) {
        checkEdt()
        val target = pending
        if (target == null) {
            val prev = baseline
            val edit = draft
            baseline = base
            if (edit == prev) draft = base
            return
        }
        if (!saved(base, target)) return
        baseline = base
    }

    @RequiresEdt
    protected fun syncLoginBanner(login: Boolean, fallback: () -> Unit) {
        checkEdt()
        if (loginBanner && login) {
            top.showNotLoggedIn { openProfile(it) }
            return
        }
        fallback()
    }

    private fun checkEdt() {
        check(ApplicationManager.getApplication().isDispatchThread) { "Settings UI updates must run on EDT" }
    }

    @RequiresEdt
    protected abstract fun change(from: D, to: D): P?

    @RequiresEdt
    protected abstract fun save(change: P, done: (R?) -> Unit)

    @RequiresEdt
    protected abstract fun base(result: R): D

    @RequiresEdt
    protected abstract fun syncContent()

    @RequiresEdt
    protected abstract fun pendingText(): String

    @RequiresEdt
    protected abstract fun failedText(): String

    @RequiresEdt
    protected abstract fun draft(state: KiloAppStateDto): D

    @RequiresBackgroundThread
    protected abstract suspend fun loadWorkspace(root: String): W

    @RequiresEdt
    protected abstract fun applyWorkspace(result: W)

    @RequiresEdt
    protected open fun saved(base: D, draft: D): Boolean = base == draft

    @RequiresEdt
    protected open fun onSaveFailedAfterDispose(change: P) = KiloNotifications.error(failedText())

    @RequiresEdt
    protected open fun logSaveStarted(change: P) = Unit

    @RequiresEdt
    protected open fun logSaveCompleted(change: P) = Unit

    @RequiresEdt
    protected open fun logSaveFailed(change: P) = Unit

    @RequiresEdt
    protected open fun logSaveFailedAfterDispose(change: P) = Unit

    @RequiresEdt
    protected open fun logSaveCompletedAfterDispose(change: P) = Unit

    @RequiresEdt
    protected open fun unavailable(state: KiloAppStateDto) = Unit

    @RequiresEdt
    protected open fun models(state: ModelStateDto) = Unit

    @RequiresEdt
    protected open fun clearWorkspaceError() = Unit

    private fun openProfile(src: JComponent) {
        val settings = Settings.KEY.getData(DataManager.getInstance().getDataContext(src))
        if (settings != null) {
            val cfg = settings.find(UserProfileConfigurable.ID)
            if (cfg != null) {
                settings.select(cfg)
                return
            }
        }

        val project = ProjectManager.getInstance().openProjects.firstOrNull { !it.isDefault }
        ShowSettingsUtil.getInstance().showSettingsDialog(
            project,
            Predicate { cfg: Configurable ->
                cfg is ConfigurableWithId && cfg.getId() == UserProfileConfigurable.ID
            },
            { cfg: Configurable -> cfg.focusOn(UserProfileConfigurable.FOCUS_ACCOUNT_COMBO) },
        )
    }

    private companion object {
        val edt = Dispatchers.EDT + ModalityState.any().asContextElement()
    }
}
