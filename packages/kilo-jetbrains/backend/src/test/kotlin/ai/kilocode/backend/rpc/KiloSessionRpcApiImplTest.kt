package ai.kilocode.backend.rpc

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.rpc.dto.ChatEventDto
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class KiloSessionRpcApiImplTest {
    private val mock = MockCliServer()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val apps = mutableListOf<KiloBackendAppService>()

    @AfterTest
    fun tearDown() {
        apps.forEach { it.dispose() }
        apps.clear()
        scope.cancel()
        mock.close()
    }

    private fun app(log: TestLog): KiloBackendAppService {
        return KiloBackendAppService.create(scope, FakeCliServer(mock), log).also { apps.add(it) }
    }

    private suspend fun ready(app: KiloBackendAppService) {
        app.connect()
        withTimeout(10_000) {
            app.appState.first { it is KiloAppState.Ready }
        }
    }

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

    @Test
    fun `create logs created session id`() = runBlocking(Dispatchers.Default) {
        val log = TestLog()
        mock.sessionCreate = """{"id":"ses_created","slug":"created","projectID":"prj_test","directory":"/test","title":"Created","version":"1.0.0","time":{"created":1000,"updated":1000}}"""
        val app = app(log)
        ready(app)
        val api = KiloSessionRpcApiImpl(appOverride = app, log = log)

        api.create("/test")

        assertTrue(log.messages.any { it.contains("create session: id=ses_created") }, log.messages.joinToString("\n"))
    }

    @Test
    fun `delete logs deleted session id`() = runBlocking(Dispatchers.Default) {
        val log = TestLog()
        val app = app(log)
        ready(app)
        val api = KiloSessionRpcApiImpl(appOverride = app, log = log)

        api.delete("ses_deleted", "/test")

        assertTrue(log.messages.any { it.contains("delete session: id=ses_deleted") }, log.messages.joinToString("\n"))
    }
}
