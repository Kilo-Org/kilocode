package ai.kilocode.backend.app

import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.net.URLDecoder
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class KiloBackendSessionManagerBackgroundJobsTest {

    private val mock = MockCliServer()
    private val log = TestLog()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val apps = mutableListOf<KiloBackendAppService>()

    @AfterTest
    fun tearDown() {
        apps.forEach { it.dispose() }
        apps.clear()
        scope.cancel()
        mock.close()
    }

    private fun setup(): KiloBackendAppService =
        KiloBackendAppService.create(scope, FakeCliServer(mock), log).also { apps.add(it) }

    private suspend fun ready(app: KiloBackendAppService) {
        app.connect()
        withTimeout(10_000) {
            app.appState.first { it is KiloAppState.Ready }
        }
    }

    @Test
    fun `backgroundJobs parses the list and flattens metadata`() = runBlocking {
        mock.backgroundJobs = """
            [
                {
                    "id": "job1",
                    "type": "task",
                    "status": "running",
                    "title": "Explore",
                    "started_at": 1000,
                    "metadata": {"sessionId": "ses_child1", "parentSessionId": "ses_root", "background": true}
                }
            ]
        """.trimIndent()
        val app = setup()
        ready(app)

        val jobs = withTimeout(10_000) { app.sessions.backgroundJobs("ses_root", "/repo").first() }

        val job = jobs.single()
        assertEquals("job1", job.id)
        assertEquals("ses_child1", job.sessionId)
        assertEquals("ses_root", job.parentSessionId)
        assertTrue(job.background)
        val path = mock.lastBackgroundJobsPath ?: error("missing background-jobs request")
        assertTrue(path.startsWith("/kilocode/background-jobs?"), "Expected background-jobs path, got $path")
        val decoded = URLDecoder.decode(path, "UTF-8")
        assertTrue(decoded.contains("directory=/repo"), decoded)
        assertTrue(decoded.contains("sessionID=ses_root"), decoded)
    }

    @Test
    fun `backgroundJobs shares one poller across concurrent subscribers`() = runBlocking {
        val app = setup()
        ready(app)

        val a = async { app.sessions.backgroundJobs("ses_root", "/repo").first() }
        val b = async { app.sessions.backgroundJobs("ses_root", "/repo").first() }
        withTimeout(10_000) { awaitAll(a, b) }

        assertEquals(1, mock.backgroundJobsRequests.size)
    }

    @Test
    fun `cancelBackgroundJob posts to the cancel route and parses the boolean body`() = runBlocking {
        mock.backgroundJobCancelResult = "true"
        val app = setup()
        ready(app)

        val result = app.sessions.cancelBackgroundJob("job1", "/repo")

        assertTrue(result)
        val path = mock.lastBackgroundJobCancelPath ?: error("missing cancel request")
        assertTrue(path.startsWith("/kilocode/background-jobs/job1/cancel?"), "Expected cancel path, got $path")
        assertTrue(URLDecoder.decode(path, "UTF-8").contains("directory=/repo"), path)
    }

    @Test
    fun `cancelBackgroundJob surfaces server failure`() = runBlocking {
        mock.backgroundJobCancelStatus = 500
        val app = setup()
        ready(app)

        val err = assertFailsWith<RuntimeException> {
            app.sessions.cancelBackgroundJob("job1", "/repo")
        }
        assertTrue(err.message.orEmpty().contains("HTTP 500"))
    }

    @Test
    fun `promoteBackgroundJob posts to the promote route`() = runBlocking {
        mock.backgroundJobPromoteResult = "true"
        val app = setup()
        ready(app)

        val result = app.sessions.promoteBackgroundJob("ses_child1", "/repo")

        assertTrue(result)
        val path = mock.lastBackgroundJobPromotePath ?: error("missing promote request")
        assertTrue(path.startsWith("/kilocode/background-jobs/ses_child1/promote?"), "Expected promote path, got $path")
    }

    @Test
    fun `promoteBackgroundJob returns false when the CLI kill switch is off`() = runBlocking {
        mock.backgroundJobPromoteResult = "false"
        val app = setup()
        ready(app)

        val result = app.sessions.promoteBackgroundJob("ses_child1", "/repo")

        assertFalse(result)
    }
}
