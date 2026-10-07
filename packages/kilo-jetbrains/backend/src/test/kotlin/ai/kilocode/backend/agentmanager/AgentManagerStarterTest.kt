package ai.kilocode.backend.agentmanager

import ai.kilocode.backend.app.KiloAppState
import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.backend.rpc.KiloWorktreeRpcApiImpl
import ai.kilocode.backend.testing.FakeCliServer
import ai.kilocode.backend.testing.MockCliServer
import ai.kilocode.backend.testing.TestLog
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.CapturingProcessHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Exercises [AgentManagerStarter] against a real temp git repository (worktrees are created by a real
 * `git` subprocess, as in production) and a [MockCliServer]-backed [KiloBackendAppService] for
 * session creation and prompting.
 *
 * `start` is fire-and-forget on the CLI side, so there is nothing to assert on the wire protocol
 * here — these tests assert the observable effects instead: a worktree on disk, a session created,
 * and a prompt delivered.
 */
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
        Files.walk(dir).use { paths -> paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) } }
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

    private fun worktreeDirs(): List<Path> {
        val root = repo.resolve(".kilo").resolve("worktrees")
        if (!Files.isDirectory(root)) return emptyList()
        return Files.list(root).use { it.toList() }
    }

    @Test
    fun `worktree mode creates a worktree, a session, and sends the prompt`() = runBlocking {
        initRepo()
        mock.sessionCreate = """{"id":"ses_new","slug":"s","projectID":"p","directory":"$repo","title":"T","version":"1","time":{"created":1,"updated":1}}"""
        val app = setup()
        ready(app)

        AgentManagerStarter(app.sessions, app.chat, worktrees, log)
            .start(start("am-1", "worktree", task("do the task", "Task A")), repo.toString())

        val created = worktreeDirs()
        assertEquals(1, created.size, "expected exactly one worktree, got $created")
        assertTrue(Files.isDirectory(created.single()))
        assertTrue(mock.awaitRequestCount("/session", 1, timeout = 5_000))
        assertTrue(mock.awaitRequestCount("/session/ses_new/prompt_async", 1, timeout = 5_000))
        assertTrue(mock.lastPromptBody?.contains("do the task") == true)
    }

    @Test
    fun `worktree mode derives the branch from the task name`() = runBlocking {
        initRepo()
        mock.sessionCreate = """{"id":"ses_new","slug":"s","projectID":"p","directory":"$repo","title":"T","version":"1","time":{"created":1,"updated":1}}"""
        val app = setup()
        ready(app)

        AgentManagerStarter(app.sessions, app.chat, worktrees, log)
            .start(start("am-2", "worktree", task(null, "Fix the Login Bug")), repo.toString())

        val branches = worktrees.list(repo.toString()).worktrees.filter { !it.main }.map { it.branch }
        assertEquals(1, branches.size)
        assertTrue(
            branches.single().startsWith("agent/fix-the-login-bug-"),
            "expected a slugged agent/ branch, got ${branches.single()}",
        )
    }

    @Test
    fun `worktree mode uses an explicitly requested branch name verbatim`() = runBlocking {
        initRepo()
        mock.sessionCreate = """{"id":"ses_new","slug":"s","projectID":"p","directory":"$repo","title":"T","version":"1","time":{"created":1,"updated":1}}"""
        val app = setup()
        ready(app)

        AgentManagerStarter(app.sessions, app.chat, worktrees, log).start(
            start("am-6", "worktree", AgentManagerProtocol.StartTask(null, "Ignored Title", "feature/explicit", null, null, null)),
            repo.toString(),
        )

        val branches = worktrees.list(repo.toString()).worktrees.filter { !it.main }.map { it.branch }
        assertEquals(listOf("feature/explicit"), branches)
    }

    @Test
    fun `local mode creates a session without a worktree`() = runBlocking {
        initRepo()
        mock.sessionCreate = """{"id":"ses_local","slug":"s","projectID":"p","directory":"$repo","title":"T","version":"1","time":{"created":1,"updated":1}}"""
        val app = setup()
        ready(app)

        AgentManagerStarter(app.sessions, app.chat, worktrees, log)
            .start(start("am-3", "local", task(null, "Task B")), repo.toString())

        assertTrue(mock.awaitRequestCount("/session", 1, timeout = 5_000))
        assertEquals(emptyList(), worktreeDirs(), "local mode must not create a worktree")
    }

    @Test
    fun `a failing task is logged and does not abandon the rest of the batch`() = runBlocking {
        initRepo()
        mock.sessionCreate = """{"id":"ses_new","slug":"s","projectID":"p","directory":"$repo","title":"T","version":"1","time":{"created":1,"updated":1}}"""
        val app = setup()
        ready(app)

        // Two worktree tasks where the first branch is taken already, so its creation fails while the
        // second still has to run to completion.
        git("branch", "agent/taken")
        val starter = AgentManagerStarter(app.sessions, app.chat, worktrees, log)
        starter.start(
            start(
                "am-4",
                "worktree",
                AgentManagerProtocol.StartTask("p1", "Task C", "agent/taken", null, null, null),
                task("p2", "Task D"),
            ),
            repo.toString(),
        )

        assertTrue(
            log.awaitMessage(timeout = 5_000) { it.contains("am-4") && it.contains("task failed") },
            "expected the failing task to be logged; got ${log.messages}",
        )
        // The second task still produced its worktree and session.
        assertEquals(1, worktreeDirs().size)
        assertTrue(mock.awaitRequestCount("/session", 1, timeout = 5_000))
    }

    @Test
    fun `an unknown worktree id is logged and creates nothing`() = runBlocking {
        initRepo()
        val app = setup()
        ready(app)

        val request = AgentManagerProtocol.Start(
            requestID = "am-5",
            sessionID = "ses_caller",
            sandboxInheritanceToken = null,
            mode = "local",
            worktreeID = "/nope",
            versions = null,
            tasks = listOf(task(null, "Task E")),
        )
        AgentManagerStarter(app.sessions, app.chat, worktrees, log).start(request, repo.toString())

        assertTrue(
            log.awaitMessage(timeout = 5_000) { it.contains("am-5") && it.contains("unknown worktree") },
            "expected the unknown worktree to be logged; got ${log.messages}",
        )
        assertEquals(0, mock.requestCount("/session"))
    }
}
