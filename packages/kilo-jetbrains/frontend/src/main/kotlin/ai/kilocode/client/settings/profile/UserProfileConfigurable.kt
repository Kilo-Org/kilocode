package ai.kilocode.client.settings.profile

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.settings.base.KiloReadyConfigurable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.components.service
import com.intellij.openapi.wm.IdeFocusManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
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
class UserProfileConfigurable : KiloReadyConfigurable() {

    private var ui: ProfileUi? = null
    private var watchJob: Job? = null
    private var focus = false

    override fun getId(): String = ID

    override fun getDisplayName(): String = KiloBundle.message("settings.profile.displayName")

    override fun preferredReady(): JComponent? = ui?.preferredFocus()

    override fun focusReady(label: String) {
        if (label != FOCUS_ACCOUNT_COMBO) return
        focus = true
        val panel = ui ?: return
        requestFocus(panel)
    }

    override fun createReadyComponent(cs: CoroutineScope): JComponent {
        val panel = buildPanel(cs)
        ui = panel
        startWatching(cs, panel)
        return panel
    }

    override fun onReadyComponentCreated(component: JComponent) {
        val panel = ui ?: return
        if (focus) requestFocus(panel)
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
    }

    override fun disposeReadyComponent(component: JComponent) {
        // Dispose UI first to invalidate pending login attempts before scope cancellation.
        val panel = ui
        val job = watchJob
        ui = null
        watchJob = null
        panel?.dispose()
        job?.cancel()
    }

    companion object {
        const val ID = "ai.kilocode.jetbrains.settings.profile"
        const val FOCUS_ACCOUNT_COMBO = "kilo.profile.account.combo"
    }
}
