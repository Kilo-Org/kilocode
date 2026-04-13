package ai.kilocode.actions

import ai.kilocode.KiloApiService
import ai.kilocode.KiloBundle
import ai.kilocode.rpc.dto.ConnectionStatusDto
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service

/**
 * Non-interactive info row at the bottom of the settings popup showing
 * connection status and CLI version (from the last health check).
 */
class StatusInfoAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        // intentionally non-actionable
    }

    override fun update(e: AnActionEvent) {
        val svc = e.project?.service<KiloApiService>() ?: return
        val status = when (svc.state.value.status) {
            ConnectionStatusDto.CONNECTED -> KiloBundle.message("toolwindow.status.connected.short")
            ConnectionStatusDto.CONNECTING -> KiloBundle.message("toolwindow.status.connecting.short")
            ConnectionStatusDto.DISCONNECTED -> KiloBundle.message("toolwindow.status.disconnected.short")
            ConnectionStatusDto.ERROR -> KiloBundle.message("toolwindow.status.error.short")
        }
        val ver = svc.version?.let { " · $it" } ?: ""
        e.presentation.text = "$status$ver"
        e.presentation.isEnabled = false
    }
}
