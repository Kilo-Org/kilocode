package ai.kilocode.actions

import ai.kilocode.KiloApiService
import ai.kilocode.rpc.dto.ConnectionStatusDto
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service

class ReinstallKiloAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        e.project?.service<KiloApiService>()?.reinstallAsync()
    }

    override fun update(e: AnActionEvent) {
        val state = e.project?.service<KiloApiService>()?.state?.value
        e.presentation.isEnabled = state?.status != ConnectionStatusDto.CONNECTING
    }
}
