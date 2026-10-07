package ai.kilocode.backend.agentmanager

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.rpc.KiloWorktreeRpcApiImpl
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import ai.kilocode.rpc.dto.AgentManagerStartProgressDto
import ai.kilocode.rpc.dto.AgentManagerStartStage
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.CapturingProcessHandler
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.onSubscription
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AgentManagerStarterTest {
    private val repo: Path = Files.createTempDirectory("kilo-starter")
    private val mock = MockCliServer()
    private val log = TestLog()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val apps = mutableListOf<KiloBackendAppService>()
    private val worktrees = KiloWorktreeRpcApiImpl()

    @AfterTest
    fun tearDown() {
        apps.forEach { it.dispose() }
        apps.clear()
        scope.cancel()
        mock.close()
        delete(repo)
    }

    private fun setup(): KiloBackendAppService =
        KiloBackendAppService.create(scope, FakeCliServer(mock), log).also { apps.add(it) }

    private suspend fun ready(app: KiloBackendAppService) {
        app.connect()
        withTimeout(10_000) { app.appState.first { it is KiloAppState.Ready } }
    }

    private fun git(vararg args: String) {
        val cmd = GeneralCommandLine(listOf("git") + args).withWorkDirectory(repo.toFile())
        val out = CapturingProcessHandler(cmd).runProcess(30_000)
        assertEquals(0, out.exitCode, "git ${args.joinToString(" ")} failed: ${out.stderr}")
    }

    private fun initRepo() {
        git("init")
        git("config", "user.email", "test@kilo.ai")
        git("config", "user.name", "Kilo Test")
        Files.writeString(repo.resolve("README.md"), "hello")
        git("add", "README.md")
        git("commit", "-m", "init")
    }

    private fun delete(dir: Path) {
        if (!Files.exists(dir)) return
        Files.walk(dir).use { paths ->
            paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
        }
    }

    /**
     * Starts collecting [count] events from [progress] in the background and returns only once a
     * subscriber is actually attached — [MutableSharedFlow.tryEmit] (what [AgentManagerStarter]
     * publishes with) drops events emitted before any collector subscribes, so the caller's
     * `start(...)` must not run until this returns.
     */
    private suspend fun collect(progress: SharedFlow<AgentManagerStartProgressDto>, count: Int): Deferred<List<AgentManagerStartProgressDto>> {
        val attached = CompletableDeferred<Unit>()
        val result = scope.async { progress.onSubscription { attached.complete(Unit) }.take(count).toList() }
        withTimeout(10_000) { attached.await() }
        return result
    }

    private fun task(prompt: String?, name: String) =
        AgentManagerProtocol.StartTask(prompt = prompt, name = name, branchName = null, providerID = null, modelID = null, variant = null)

    private fun start(requestID: String, mode: String, vararg tasks: AgentManagerProtocol.StartTask) =
        AgentManagerProtocol.Start(
            requestID = requestID,
            sessionID = "ses_caller",
            sandboxInheritanceToken = null,
            mode = mode,
            worktreeID = null,
            versions = null,
            tasks = tasks.toList(),
        )

    @Test
    fun `worktree mode creates a worktree, a session, and sends the prompt`() = runBlocking {
        initRepo()
        mock.sessionCreate = """{"id":"ses_new","slug":"s","projectID":"p","directory":"$repo/.kilo/worktrees/agent-task-a-0","title":"T","version":"1","time":{"created":1,"updated":1}}"""
        val app = setup()
        ready(app)
        val starter = AgentManagerStarter(app.sessions, app.chat, worktrees)

        val collector = collect(starter.progress, 2)
        starter.start(start("am-1", "worktree", task("do the task", "Task A")), repo.toString())
        val events = withTimeout(10_000) { collector.await() }

        assertEquals(AgentManagerStartStage.PREPARING, events[0].stage)
        assertEquals(AgentManagerStartStage.READY, events[1].stage)
        assertEquals("ses_new", events[1].sessionID)
        val worktreeID = assertNotNull(events[1].worktreeID)

        assertTrue(mock.awaitRequestCount("/session", 1, timeout = 5_000))
        assertTrue(mock.awaitRequestCount("/session/ses_new/prompt_async", 1, timeout = 5_000))
        assertTrue(Files.isDirectory(Path.of(worktreeID)), "expected a real worktree at $worktreeID")
    }

    @Test
    fun `local mode does not create a worktree`() = runBlocking {
        initRepo()
        mock.sessionCreate = """{"id":"ses_local","slug":"s","projectID":"p","directory":"$repo","title":"T","version":"1","time":{"created":1,"updated":1}}"""
        val app = setup()
        ready(app)
        val starter = AgentManagerStarter(app.sessions, app.chat, worktrees)

        val collector = collect(starter.progress, 2)
        starter.start(start("am-2", "local", task(null, "Task B")), repo.toString())
        val events = withTimeout(10_000) { collector.await() }

        assertEquals(AgentManagerStartStage.READY, events[1].stage)
        assertNull(events[1].worktreeID)
        assertTrue(Files.notExists(repo.resolve(".kilo").resolve("worktrees")), "local mode must not create a worktree")
    }

    @Test
    fun `a failed task reports failed progress without throwing`() = runBlocking {
        initRepo()
        mock.sessionCreateStatus = 500
        val app = setup()
        ready(app)
        val starter = AgentManagerStarter(app.sessions, app.chat, worktrees)

        val collector = collect(starter.progress, 2)
        starter.start(start("am-3", "local", task(null, "Task C")), repo.toString())
        val events = withTimeout(10_000) { collector.await() }

        assertEquals(AgentManagerStartStage.PREPARING, events[0].stage)
        assertEquals(AgentManagerStartStage.FAILED, events[1].stage)
        assertNotNull(events[1].error)
    }

    @Test
    fun `two local tasks each report their own preparing and ready progress`() = runBlocking {
        initRepo()
        mock.sessionCreate = """{"id":"ses_new","slug":"s","projectID":"p","directory":"$repo","title":"T","version":"1","time":{"created":1,"updated":1}}"""
        val app = setup()
        ready(app)
        val starter = AgentManagerStarter(app.sessions, app.chat, worktrees)

        // AgentManagerStarter.start runs its tasks sequentially (see its doc) — a failure in one task
        // is caught per-task and does not stop the rest, which this asserts indirectly: both tasks
        // here succeed and both report their own independent PREPARING/READY pair rather than one
        // task's failure aborting the other's progress.
        val collector = collect(starter.progress, 4)
        starter.start(start("am-4", "local", task(null, "Task D"), task(null, "Task E")), repo.toString())
        val events = withTimeout(10_000) { collector.await() }

        assertEquals(2, events.count { it.stage == AgentManagerStartStage.PREPARING })
        assertEquals(2, events.count { it.stage == AgentManagerStartStage.READY })
    }
}
