package ai.kilocode.client.session.controller

import ai.kilocode.rpc.dto.AgentDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.ModelDto
import ai.kilocode.rpc.dto.ProviderDto

/**
 * Covers [SessionController.applySelection], the New Worktree entry point that seeds a fresh
 * session's mode / model / reasoning so the pickers and every later turn use the dialog's pick —
 * not just the single first prompt.
 */
class SessionControllerSelectionTest : SessionControllerTestBase() {

    fun `test applySelection seeds agent, model and variant and rides the first prompt`() {
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady(
            agents = listOf(AgentDto("code", "Code", mode = "code"), AgentDto("plan", "Plan", mode = "plan")),
            default = "code",
            providers = listOf(
                ProviderDto(
                    id = "kilo",
                    name = "Kilo",
                    models = mapOf(
                        "gpt-5" to ModelDto(id = "gpt-5", name = "GPT-5"),
                        "opus" to ModelDto(id = "opus", name = "Opus", variants = listOf("low", "high")),
                    ),
                ),
            ),
        )
        val m = controller()
        flush()

        edt { m.applySelection(PromptSelection("plan", "kilo", "opus", "high")) }
        flush()

        var agent: String? = null
        var model: String? = null
        var variant: String? = null
        edt {
            agent = m.model.agent
            model = m.model.model
            variant = m.model.variant
        }
        assertEquals("plan", agent)
        assertEquals("kilo/opus", model)
        assertEquals("high", variant)

        edt { m.prompt("go") }
        flush()

        val sent = rpc.prompts.single()
        assertEquals("plan", sent.third.agent)
        assertEquals("kilo", sent.third.providerID)
        assertEquals("opus", sent.third.modelID)
        assertEquals("high", sent.third.variant)
    }
}
