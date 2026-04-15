package ai.kilocode.client.actions

import ai.kilocode.client.KiloAppService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.KiloAppStatusDto
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
        val svc = service<KiloAppService>()
        val status = when (svc.state.value.status) {
            KiloAppStatusDto.READY -> KiloBundle.message("toolwindow.status.connected.short")
            KiloAppStatusDto.CONNECTING -> KiloBundle.message("toolwindow.status.connecting.short")
            KiloAppStatusDto.LOADING -> KiloBundle.message("toolwindow.status.loading.short")
            KiloAppStatusDto.DISCONNECTED -> KiloBundle.message("toolwindow.status.disconnected.short")
            KiloAppStatusDto.ERROR -> KiloBundle.message("toolwindow.status.error.short")
        }
        val ver = svc.version?.let { " · $it" } ?: ""
        e.presentation.text = "$status$ver"
        e.presentation.isEnabled = false
    }
}
