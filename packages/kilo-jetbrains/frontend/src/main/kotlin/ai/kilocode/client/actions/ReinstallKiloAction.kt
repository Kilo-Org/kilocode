package ai.kilocode.client.actions

import ai.kilocode.client.app.KiloAppService
import ai.kilocode.rpc.dto.KiloAppStatusDto
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service

class ReinstallKiloAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        service<KiloAppService>().reinstallAsync()
    }

    override fun update(e: AnActionEvent) {
        val status = service<KiloAppService>().state.value.status
        e.presentation.isEnabled = status != KiloAppStatusDto.CONNECTING && status != KiloAppStatusDto.LOADING
    }
}
