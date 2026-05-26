package ai.kilocode.client.settings.profile

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.plugin.KiloBundle
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.components.service
import com.intellij.openapi.options.SearchableConfigurable
import com.intellij.openapi.wm.IdeFocusManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.swing.JComponent

/**
 * Settings panel for Kilo user profile.
 *
 * Located at Settings -> Tools -> Kilo -> User Profile.
 *
 * Shows login / logout, current balance, personal/org account selector,
 * and a link to the Kilo dashboard. This is a status/action panel — it
 * has no persistent settings, so [isModified] always returns false.
 */
class UserProfileConfigurable : SearchableConfigurable {

    private var ui: JComponent? = null
    private var scope: CoroutineScope? = null
    private var watchJob: Job? = null
    private var focus = false

    override fun getId(): String = ID

    override fun getDisplayName(): String = KiloBundle.message("settings.profile.displayName")

    override fun getPreferredFocusedComponent(): JComponent? = (ui as? ProfileUi)?.preferredFocus()

    override fun focusOn(label: String) {
        if (label != FOCUS_ACCOUNT_COMBO) return
        focus = true
        val panel = ui as? ProfileUi ?: return
        requestFocus(panel)
    }

    override fun createComponent(): JComponent {
        val cs = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        scope = cs
        val panel = buildPanel(cs)
        ui = panel
        startWatching(cs, panel)
        if (focus) requestFocus(panel)
        return panel
    }

    private fun requestFocus(panel: ProfileUi) {
        val app = ApplicationManager.getApplication()
        app.invokeLater({
            app.invokeLater({
                val target = panel.preferredFocus()
                if (target.isShowing) IdeFocusManager.getGlobalInstance().requestFocus(target, true)
            }, ModalityState.any())
        }, ModalityState.any())
    }

    private fun buildPanel(cs: CoroutineScope): ProfileUi {
        val app = service<KiloAppService>()
        return ProfileUi(app.state.value.profile, app.state.value.status, cs)
    }

    private fun startWatching(cs: CoroutineScope, panel: ProfileUi) {
        val app = service<KiloAppService>()
        watchJob = cs.launch {
            app.state.collect { state ->
                withContext(edt) {
                    panel.update(state)
                }
            }
        }
        cs.launch {
            app.connect()
        }
    }

    override fun isModified(): Boolean = false

    override fun apply() = Unit

    override fun reset() = Unit

    override fun disposeUIResources() {
        // Dispose UI first to invalidate pending login attempts before scope cancellation.
        // Capturing local refs before nulling fields so the EDT callback is self-contained.
        val panel = ui as? ProfileUi
        val job = watchJob
        val cs = scope
        ui = null
        watchJob = null
        scope = null

        val app = ApplicationManager.getApplication()
        if (panel != null) {
            if (app.isDispatchThread) {
                panel.dispose()
                job?.cancel()
                cs?.cancel()
            } else {
                // Schedule on EDT so dispose runs before scope cancel, as the plan requires.
                app.invokeLater({
                    panel.dispose()
                    job?.cancel()
                    cs?.cancel()
                }, ModalityState.any())
            }
        } else {
            job?.cancel()
            cs?.cancel()
        }
    }

    companion object {
        const val ID = "ai.kilocode.jetbrains.settings.profile"
        const val FOCUS_ACCOUNT_COMBO = "kilo.profile.account.combo"
    }
}
