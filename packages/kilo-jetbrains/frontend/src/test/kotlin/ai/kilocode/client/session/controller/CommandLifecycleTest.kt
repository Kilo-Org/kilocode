package ai.kilocode.client.session.controller

import ai.kilocode.client.session.model.SessionState
import ai.kilocode.rpc.dto.CommandDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto

class CommandLifecycleTest : SessionControllerTestBase() {

    fun `test command creates new session and calls RPC`() {
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady().copy(commands = listOf(CommandDto("deploy")))
        val m = controller()

        flush()
        edt { m.command("deploy", "prod") }
        flush()

        assertEquals(1, rpc.creates)
        assertEquals(1, rpc.commands.size)
        val call = rpc.commands.single()
        assertEquals("ses_test", call.id)
        assertEquals("/test", call.directory)
        assertEquals("deploy", call.command)
        assertEquals("prod", call.arguments)
    }

    fun `test command reuses existing session`() {
        val (m, _, _) = prompted()
        val created = rpc.creates

        edt { m.command("deploy", "prod") }
        flush()

        assertEquals(created, rpc.creates)
        assertEquals("ses_test", rpc.commands.single().id)
    }

    fun `test command records telemetry`() {
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady().copy(commands = listOf(CommandDto("deploy")))
        val m = controller()

        flush()
        edt { m.command("deploy", "prod") }
        flush()

        val sent = appRpc.telemetry.single { it.event == "Conversation Send Clicked" }
        assertEquals("command", sent.properties["source"])
        assertEquals("true", sent.properties["hasSlashCommand"])
        assertEquals("server", sent.properties["slashCommandType"])
        val message = appRpc.telemetry.single { it.event == "Conversation Message" }
        assertEquals("command", message.properties["source"])
        assertEquals("true", message.properties["hasSlashCommand"])
        assertEquals("server", message.properties["slashCommandType"])
    }

    fun `test command errors set state and telemetry`() {
        appRpc.state.value = KiloAppStateDto(KiloAppStatusDto.READY, config = ConfigDto(model = "kilo/gpt-5"))
        projectRpc.state.value = workspaceReady().copy(commands = listOf(CommandDto("deploy")))
        rpc.commandThrows = IllegalStateException("boom")
        val m = controller()

        flush()
        edt { m.command("deploy", "prod") }
        flush()

        assertTrue(m.model.state is SessionState.Error)
        val event = appRpc.telemetry.single { it.event == "Session Error" }
        assertEquals("command", event.properties["context"])
    }
}
