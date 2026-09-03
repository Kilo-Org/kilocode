package ai.kilocode.backend.run

import ai.kilocode.backend.testing.StubbornJvm
import com.intellij.openapi.util.SystemInfo
import kotlinx.coroutines.runBlocking
import java.nio.file.Files
import java.time.Instant
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class WorktreeRunReaperTest {
    private val worktree = "/repo/.kilo/worktrees/wt"
    private val now = Instant.now()

    @Test
    fun `matches a java process whose command line references the worktree`() {
        val entry = entry(pid = 100, exe = "java", cmd = "java -cp $worktree/build/classes Main", start = now)
        assertEquals(listOf(100L), WorktreeRunReaper.match(worktree, now, listOf(entry)))
    }

    @Test
    fun `ignores a non-java process even if it references the worktree`() {
        val entry = entry(pid = 100, exe = "node", cmd = "node $worktree/server.js", start = now)
        assertEquals(emptyList(), WorktreeRunReaper.match(worktree, now, listOf(entry)))
    }

    @Test
    fun `ignores a java process that does not reference the worktree`() {
        val entry = entry(pid = 100, exe = "java", cmd = "java -cp /repo/build/classes Main", start = now)
        assertEquals(emptyList(), WorktreeRunReaper.match(worktree, now, listOf(entry)))
    }

    @Test
    fun `excludes a process that started before the run`() {
        val cmd = "java -cp $worktree/build/classes Main"
        val entry = entry(pid = 100, exe = "java", cmd = cmd, start = now.minusSeconds(10))
        assertEquals(emptyList(), WorktreeRunReaper.match(worktree, now, listOf(entry)))
    }

    @Test
    fun `includes a process at the exact start instant`() {
        val entry = entry(pid = 100, exe = "java", cmd = "java -cp $worktree/build/classes Main", start = now)
        assertEquals(listOf(100L), WorktreeRunReaper.match(worktree, now, listOf(entry)))
    }

    @Test
    fun `keeps a process whose start time could not be determined`() {
        val entry = entry(pid = 100, exe = "java", cmd = "java -cp $worktree/build/classes Main", start = null)
        assertEquals(listOf(100L), WorktreeRunReaper.match(worktree, now, listOf(entry)))
    }

    @Test
    fun `excludes the gradle daemon even though it references the worktree`() {
        val cmd = "java org.gradle.launcher.daemon.bootstrap.GradleDaemon $worktree"
        assertEquals(emptyList(), WorktreeRunReaper.match(worktree, now, listOf(entry(100, "java", cmd, now))))
    }

    @Test
    fun `excludes a gradle worker daemon under its relocated package`() {
        // Compile/test workers are shared across builds; killing one costs a restart and fixes nothing.
        val cmd = "java -cp /gradle/lib worker.org.gradle.process.internal.worker.GradleWorkerMain $worktree"
        assertEquals(emptyList(), WorktreeRunReaper.match(worktree, now, listOf(entry(100, "java", cmd, now))))
    }

    @Test
    fun `excludes the kotlin compile daemon`() {
        val cmd = "java org.jetbrains.kotlin.daemon.KotlinCompileDaemon $worktree"
        assertEquals(emptyList(), WorktreeRunReaper.match(worktree, now, listOf(entry(100, "java", cmd, now))))
    }

    @Test
    fun `excludes the ide's own process`() {
        val self = ProcessHandle.current().pid()
        val entry = entry(pid = self, exe = "java", cmd = "java -cp $worktree/build/classes Main", start = now)
        assertEquals(emptyList(), WorktreeRunReaper.match(worktree, now, listOf(entry)))
    }

    @Test
    fun `matches javaw exe case-insensitively regardless of path separators`() {
        val entry = entry(pid = 100, exe = "C:\\jdk\\bin\\JAVAW.EXE", cmd = "javaw -cp $worktree\\build Main", start = now)
        assertEquals(listOf(100L), WorktreeRunReaper.match(worktree, now, listOf(entry)))
    }

    @Test
    fun `scan finds the current process`() = runBlocking {
        val self = ProcessHandle.current().pid()
        assertTrue(WorktreeRunReaper.scan().any { it.pid == self })
    }

    @Test
    fun `scan and match find a real jvm started for the worktree`() = runBlocking {
        val dir = Files.createTempDirectory("kilo-reaper-wt").toString()
        val since = Instant.now().minusSeconds(1)
        val app = StubbornJvm.start(dir)
        try {
            val entries = WorktreeRunReaper.scan()
            val mine = entries.singleOrNull { it.pid == app.pid() }
            assertTrue(mine != null, "scan did not report the spawned JVM; scanned ${entries.size} entries")
            assertEquals(listOf(app.pid()), WorktreeRunReaper.match(dir, since, entries), "entry was $mine")
            // The same JVM is not matched for an unrelated worktree.
            assertEquals(emptyList(), WorktreeRunReaper.match("$dir-other", since, entries))
        } finally {
            app.destroyForcibly()
        }
    }

    /**
     * Graceful is the whole point of the fallback: a SIGTERM'd app runs its shutdown hooks, so a
     * Spring Boot app releases its port and closes its context instead of dying mid-request. The exit
     * status proves which signal was sent — the JVM reports `0x80 + signal` for a signalled process.
     */
    @Test
    fun `graceful terminate signals a real process with SIGTERM`() {
        if (SystemInfo.isWindows) return
        val process = ProcessBuilder("sleep", "30").start()
        try {
            assertFalse(WorktreeRunReaper.allDead(listOf(process.pid())))
            WorktreeRunReaper.terminate(listOf(process.pid()), force = false)
            assertTrue(process.waitFor(PROCESS_TIMEOUT_SECONDS, TimeUnit.SECONDS), "process did not exit")
            assertEquals(SIGTERM_EXIT, process.exitValue())
            assertTrue(WorktreeRunReaper.allDead(listOf(process.pid())))
        } finally {
            process.destroyForcibly()
        }
    }

    @Test
    fun `force terminate signals a real process with SIGKILL`() {
        if (SystemInfo.isWindows) return
        val process = ProcessBuilder("sleep", "30").start()
        try {
            WorktreeRunReaper.terminate(listOf(process.pid()), force = true)
            assertTrue(process.waitFor(PROCESS_TIMEOUT_SECONDS, TimeUnit.SECONDS), "process did not exit")
            assertEquals(SIGKILL_EXIT, process.exitValue())
            assertTrue(WorktreeRunReaper.allDead(listOf(process.pid())))
        } finally {
            process.destroyForcibly()
        }
    }

    @Test
    fun `allDead reports an unknown pid as dead`() {
        // A pid that has already been reaped has no ProcessHandle, which must not read as "still alive"
        // or the popup would keep an orphan row forever.
        assertTrue(WorktreeRunReaper.allDead(listOf(Long.MAX_VALUE)))
    }

    private fun entry(pid: Long, exe: String, cmd: String, start: Instant?) = WorktreeRunReaper.Entry(pid, exe, cmd, start)

    private companion object {
        private const val PROCESS_TIMEOUT_SECONDS = 5L

        /** The JVM reports a signalled process as `0x80 + signal`. */
        private const val SIGTERM_EXIT = 0x80 + 15
        private const val SIGKILL_EXIT = 0x80 + 9
    }
}
