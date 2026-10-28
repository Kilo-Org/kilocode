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
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Exercises [AgentManagerOverview] against a real temp git repository (worktree data comes from a
 * real `git` subprocess, exactly like production) and a [MockCliServer]-backed [KiloBackendAppService]
 * for session/permission/question data.
 */
class AgentManagerOverviewTest {
    private val repo: Path = Files.createTempDirectory("kilo-overview")
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

    private fun delete(dir: Path) {
        if (!Files.exists(dir)) return
        Files.walk(dir).use { paths ->
            paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
        }
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

    @Test
    fun `build reports an empty sections array and the local session group`() = runBlocking {
        initRepo()
        mock.sessions = """[
            {"id":"ses_1","slug":"s","projectID":"p","directory":"${repo}","title":"Local work","version":"1","time":{"created":1,"updated":1}}
        ]"""
        val app = setup()
        ready(app)

        val overview = AgentManagerOverview.build(repo.toString(), app.sessions, app.chat, worktrees, null, null)

        assertEquals(0, overview["sections"]!!.jsonArray.size)
        assertEquals(0, overview["ungrouped"]!!.jsonArray.size)
        val local = overview["local"]!!.jsonObject
        val sessionRows = local["sessions"]!!.jsonArray
        assertEquals(1, sessionRows.size)
        assertEquals("ses_1", sessionRows[0].jsonObject["id"]!!.jsonPrimitive.content)
        assertEquals("Local work", sessionRows[0].jsonObject["name"]!!.jsonPrimitive.content)
        assertEquals("idle", sessionRows[0].jsonObject["activity"]!!.jsonPrimitive.content)
    }

    @Test
    fun `build reports busy activity from session status`() = runBlocking {
        initRepo()
        mock.sessions = """[{"id":"ses_1","slug":"s","projectID":"p","directory":"${repo}","title":"T","version":"1","time":{"created":1,"updated":1}}]"""
        mock.sessionStatuses = """{"ses_1":{"type":"busy"}}"""
        val app = setup()
        ready(app)

        val overview = AgentManagerOverview.build(repo.toString(), app.sessions, app.chat, worktrees, null, null)
        val row = overview["local"]!!.jsonObject["sessions"]!!.jsonArray[0].jsonObject
        assertEquals("busy", row["activity"]!!.jsonPrimitive.content)
    }

    @Test
    fun `build reports attention for a session with a pending permission`() = runBlocking {
        initRepo()
        mock.sessions = """[{"id":"ses_1","slug":"s","projectID":"p","directory":"${repo}","title":"T","version":"1","time":{"created":1,"updated":1}}]"""
        mock.pendingPermissions = """[{"id":"perm_1","sessionID":"ses_1","permission":"edit","patterns":[]}]"""
        val app = setup()
        ready(app)

        val overview = AgentManagerOverview.build(repo.toString(), app.sessions, app.chat, worktrees, null, null)
        val row = overview["local"]!!.jsonObject["sessions"]!!.jsonArray[0].jsonObject
        val attention = row["attention"]!!.jsonArray.map { it.jsonPrimitive.content }
        assertTrue("permission" in attention)
    }

    @Test
    fun `build filters sessions by the requested states`() = runBlocking {
        initRepo()
        mock.sessions = """[{"id":"ses_1","slug":"s","projectID":"p","directory":"${repo}","title":"T","version":"1","time":{"created":1,"updated":1}}]"""
        mock.sessionStatuses = """{"ses_1":{"type":"busy"}}"""
        val app = setup()
        ready(app)

        val idleOnly = AgentManagerOverview.build(repo.toString(), app.sessions, app.chat, worktrees, null, listOf("idle"))
        assertEquals(0, idleOnly["local"]!!.jsonObject["sessions"]!!.jsonArray.size)

        val busyOnly = AgentManagerOverview.build(repo.toString(), app.sessions, app.chat, worktrees, null, listOf("busy"))
        assertEquals(1, busyOnly["local"]!!.jsonObject["sessions"]!!.jsonArray.size)
    }

    @Test
    fun `build lists a created worktree under ungrouped with its branch`() = runBlocking {
        initRepo()
        git("worktree", "add", "-b", "feature-x", repo.resolve(".kilo/worktrees/feature-x").toString())
        mock.sessions = "[]"
        val app = setup()
        ready(app)

        val overview = AgentManagerOverview.build(repo.toString(), app.sessions, app.chat, worktrees, null, null)
        val ungrouped = overview["ungrouped"]!!.jsonArray
        assertEquals(1, ungrouped.size)
        assertEquals("feature-x", ungrouped[0].jsonObject["branch"]!!.jsonPrimitive.content)
    }

    @Test
    fun `build ignores an unmatchable sectionIDs filter instead of rejecting`() = runBlocking {
        initRepo()
        mock.sessions = "[]"
        val app = setup()
        ready(app)

        val overview = AgentManagerOverview.build(repo.toString(), app.sessions, app.chat, worktrees, listOf("some-section"), null)
        assertEquals(0, overview["sections"]!!.jsonArray.size)
    }

    @Test
    fun `build clamps an oversized session name to the protocol limit`() = runBlocking {
        initRepo()
        val longTitle = "x".repeat(10_000)
        mock.sessions = """[{"id":"ses_1","slug":"s","projectID":"p","directory":"${repo}","title":"$longTitle","version":"1","time":{"created":1,"updated":1}}]"""
        val app = setup()
        ready(app)

        val overview = AgentManagerOverview.build(repo.toString(), app.sessions, app.chat, worktrees, null, null)
        val row = overview["local"]!!.jsonObject["sessions"]!!.jsonArray[0].jsonObject
        assertEquals(500, row["name"]!!.jsonPrimitive.content.length)
    }

    @Test
    fun `build has no local group when there is no main worktree row`() = runBlocking {
        // An unreadable/missing root reports an empty worktree list, so `main` is null.
        mock.sessions = "[]"
        val app = setup()
        ready(app)

        val missing = repo.resolve("does-not-exist").toString()
        val overview = AgentManagerOverview.build(missing, app.sessions, app.chat, worktrees, null, null)
        assertFalse(overview.containsKey("local"))
    }
}
