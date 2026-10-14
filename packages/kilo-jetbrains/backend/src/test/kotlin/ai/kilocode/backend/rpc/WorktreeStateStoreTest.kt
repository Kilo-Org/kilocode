package ai.kilocode.backend.rpc

import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.CapturingProcessHandler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class WorktreeStateStoreTest {
    private val root = Files.createTempDirectory("kilo-worktree-state")
    private val file = worktreeStateFile(root)
    private val store = WorktreeStateStore()

    @AfterTest
    fun tearDown() {
        delete(root)
    }

    @Test
    fun `repo catalog is persisted with worktree state`() = runBlocking {
        store.update(file) {
            it.copy(
                names = mapOf("/worktree" to "Feature"),
                repos = listOf(RepoEntry("/repo/api", "API", 0, NOW)),
                dismissed = listOf("/repo/vendor"),
            )
        }

        val state = readWorktreeState(file)
        assertEquals(mapOf("/worktree" to "Feature"), state.names)
        assertEquals(listOf(RepoEntry("/repo/api", "API", 0, NOW)), state.repos)
        assertEquals(listOf("/repo/vendor"), state.dismissed)
    }

    @Test
    fun `worktree reconciliation preserves repo catalog fields`() {
        val state = WorktreeState(
            names = mapOf("/gone" to "Gone"),
            worktreeOrder = listOf("/gone"),
            repos = listOf(RepoEntry("/repo/api", "API", 0, NOW)),
            dismissed = listOf("/repo/vendor"),
        )

        val next = state.reconcile(paths = emptyList(), live = emptyList())

        assertTrue(next.names.isEmpty())
        assertEquals(state.repos, next.repos)
        assertEquals(state.dismissed, next.dismissed)
    }

    @Test
    fun `unknown JSON fields survive a write`() = runBlocking {
        Files.createDirectories(file.parent)
        Files.writeString(
            file,
            """{"future":{"enabled":true},"names":{},"repos":[{"root":"/repo/api","futureRepo":"kept"}]}""",
        )

        store.update(file) { state -> state.copy(repos = state.repos.map { it.copy(label = "API") }) }

        val json = Json.parseToJsonElement(Files.readString(file)).jsonObject
        assertTrue(json["future"]!!.jsonObject["enabled"]!!.jsonPrimitive.content.toBoolean())
        val repo = json["repos"]!!.jsonArray.single().jsonObject
        assertEquals("/repo/api", repo["root"]!!.jsonPrimitive.content)
        assertEquals("kept", repo["futureRepo"]!!.jsonPrimitive.content)
        assertEquals("API", repo["label"]!!.jsonPrimitive.content)
    }

    @Test
    fun `an incompatible future schema is not overwritten`() = runBlocking {
        Files.createDirectories(file.parent)
        val raw = """{"names":{},"repos":{"future":true}}"""
        Files.writeString(file, raw)

        assertFailsWith<Exception> { store.update(file) { it.copy(dismissed = listOf("/repo/vendor")) } }

        assertEquals(raw, Files.readString(file))
    }

    @Test
    fun `concurrent updates do not lose repo entries`() = runBlocking {
        (0 until REPOS).map { index ->
            async(Dispatchers.Default) {
                store.update(file) { state ->
                    state.copy(repos = state.repos + RepoEntry("/repo/$index", order = index))
                }
            }
        }.awaitAll()

        assertEquals(REPOS, store.read(file).repos.size)
    }

    @Test
    fun `non-git fallback ignore keeps existing entries`() = runBlocking {
        val ignore = file.parent.resolve(".gitignore")
        Files.createDirectories(ignore.parent)
        Files.writeString(ignore, "node_modules\n")

        store.update(file) { it.copy(repos = listOf(RepoEntry("/repo/api"))) }
        store.update(file) { it.copy(dismissed = listOf("/repo/vendor")) }

        assertEquals(listOf("node_modules", ".gitignore", WORKTREE_STATE_FILE, ".jetbrains.lock"), Files.readAllLines(ignore))
    }

    @Test
    fun `state file and generated ignore do not dirty the repository`() = runBlocking {
        git("init")

        store.update(file) { it.copy(repos = listOf(RepoEntry("/repo/api"))) }

        assertEquals("", git("status", "--porcelain").trim())
        val raw = Path.of(git("rev-parse", "--git-path", "info/exclude").trim())
        val exclude = if (raw.isAbsolute) raw else root.resolve(raw)
        assertTrue(Files.readAllLines(exclude).containsAll(listOf("/.kilo/$WORKTREE_STATE_FILE", "/.kilo/.jetbrains.lock")))
        assertTrue(Files.notExists(file.parent.resolve(".gitignore")), "git projects use local info/exclude")
    }

    @Test
    fun `tracked kilo gitignore is not modified`() = runBlocking {
        git("init")
        val ignore = file.parent.resolve(".gitignore")
        Files.createDirectories(ignore.parent)
        Files.writeString(ignore, "tracked-rule\n")
        git("add", ".kilo/.gitignore")

        store.update(file) { it.copy(repos = listOf(RepoEntry("/repo/api"))) }

        assertEquals("tracked-rule\n", Files.readString(ignore))
    }

    @Test
    fun `state file resolves the same root through a symlink`() {
        val alias = root.parent.resolve("${root.fileName}-alias")
        Files.createSymbolicLink(alias, root)
        try {
            assertEquals(file, worktreeStateFile(alias))
        } finally {
            Files.deleteIfExists(alias)
        }
    }

    private fun git(vararg args: String): String {
        val cmd = GeneralCommandLine(listOf("git") + args).withWorkDirectory(root.toFile())
        val out = CapturingProcessHandler(cmd).runProcess(30_000)
        assertEquals(0, out.exitCode, "git ${args.joinToString(" ")} failed: ${out.stderr}")
        return out.stdout
    }

    private fun delete(dir: Path) {
        if (!Files.exists(dir)) return
        Files.walk(dir).use { paths ->
            paths.sorted(Comparator.reverseOrder()).forEach { Files.deleteIfExists(it) }
        }
    }

    private companion object {
        const val NOW = "2020-01-01T00:00:00Z"
        const val REPOS = 20
    }
}
