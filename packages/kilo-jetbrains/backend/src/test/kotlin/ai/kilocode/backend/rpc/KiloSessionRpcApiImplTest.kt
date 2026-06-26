package ai.kilocode.backend.rpc

import ai.kilocode.backend.testing.TestLog
import ai.kilocode.rpc.dto.ChatEventDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class KiloSessionRpcApiImplTest {

    @Test
    fun `events logs normal completion`() = runBlocking(Dispatchers.Default) {
        val log = TestLog()
        val api = KiloSessionRpcApiImpl(log = log, source = flowOf(ChatEventDto.TurnOpen("ses_test")))

        api.events("ses_test", "/test").toList()

        assertTrue(log.messages.any { it.contains("route=rpc-events start=true") }, log.messages.joinToString("\n"))
        assertTrue(log.messages.any { it.contains("route=rpc-events stop=true cancelled=false") }, log.messages.joinToString("\n"))
    }

    @Test
    fun `events logs cancelled completion`() = runBlocking(Dispatchers.Default) {
        val log = TestLog()
        val api = KiloSessionRpcApiImpl(log = log, source = flow { kotlinx.coroutines.awaitCancellation() })
        val job = launch { api.events("ses_test", "/test").collect {} }
        assertTrue(log.awaitMessage { it.contains("route=rpc-events start=true") })

        job.cancelAndJoin()

        assertTrue(log.messages.any { it.contains("route=rpc-events stop=true cancelled=true") }, log.messages.joinToString("\n"))
    }

    @Test
    fun `events logs failed completion`() = runBlocking(Dispatchers.Default) {
        val log = TestLog()
        val api = KiloSessionRpcApiImpl(log = log, source = flow { throw IllegalStateException("stream failed") })

        assertFailsWith<IllegalStateException> {
            api.events("ses_test", "/test").toList()
        }

        assertTrue(log.messages.any { it.contains("route=rpc-events stop=true failed message=stream failed") }, log.messages.joinToString("\n"))
    }
}
