package ai.kilocode.backend.run

import ai.kilocode.log.KiloLog
import com.intellij.execution.process.OSProcessUtil
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.nio.file.Path
import java.time.Duration
import java.time.Instant

/**
 * Best-effort cleanup for a worktree's forked application process once its
 * [com.intellij.execution.process.ProcessHandler] is already gone — e.g. a Spring Boot app started
 * via a delegated Gradle `bootRun`/`JavaExec` task, cancelled through the Tooling API, whose forked
 * JVM did not exit. [WorktreeRunManager] uses this after `stop`/`release` so the popup's Kill action
 * and worktree removal can still terminate a process the platform's own Stop button has no handle on.
 *
 * Matching is by worktree path in the process command line rather than pid lineage: the forked app
 * JVM's parent is the Gradle daemon, not the IDE, so there is no [ProcessHandle] chain from us to it.
 * [OSProcessUtil.getProcessList] is used for the scan instead of `ProcessHandle.allProcesses()`
 * because [ProcessHandle.Info.commandLine] is empty on Windows, whereas the OS-native scan returns a
 * usable command line on every platform this plugin supports; [ProcessHandle] is used only for the
 * per-pid start time and for termination.
 */
internal object WorktreeRunReaper {
    private val LOG = KiloLog.create(WorktreeRunReaper::class.java)

    /**
     * Shared, build-owned processes that legitimately reference a worktree path but must never be
     * reaped: killing one costs an unrelated restart and fixes nothing, because the application a
     * delegated run forks is never one of them — a `JavaExec`/`bootRun` child is a plain JVM launched
     * with the application's own main class. Matched as bare class names so Gradle's relocated worker
     * package (`worker.org.gradle...`) is covered too.
     */
    private val DENYLIST = listOf(
        "GradleDaemon",
        "GradleWrapperMain",
        "GradleWorkerMain",
        "KotlinCompileDaemon",
    )

    /**
     * Characters that legitimately follow a directory path: a separator continuing into a file inside
     * it, or an argument/classpath delimiter ending it. Anything else (a letter, digit, `-`, `.`) means
     * the match ran into a sibling directory whose name merely starts the same.
     */
    private val BOUNDARY = Regex("[/\\\\:;,\\s'\"]")

    /**
     * How much earlier than the caller's reference point a process may report having started and still
     * count as started after it.
     *
     * Process start times come from the OS, not from the JVM clock, and the two do not agree to the
     * instant. macOS reports milliseconds where `Instant.now()` carries microseconds; Linux derives the
     * value from boot time plus scheduler ticks, and boot time is only readable in whole seconds, so a
     * process can report having started a second before a reference instant taken moments earlier.
     * Without slack such an application is silently never reaped — which is precisely how this feature
     * passed on macOS and failed on Linux CI.
     *
     * The guard exists to spare processes that predate the run entirely, and those are typically minutes
     * old, so a few seconds of tolerance does not weaken it.
     */
    private val CLOCK_SLACK: Duration = Duration.ofSeconds(3)

    data class Entry(val pid: Long, val executable: String, val commandLine: String, val start: Instant?)

    /**
     * A live snapshot of local processes. [OSProcessUtil.getProcessList] forks `ps` and parses its
     * output, so this is blocking I/O and runs on [Dispatchers.IO] rather than on the caller's
     * (CPU-bound) service scope.
     */
    suspend fun scan(): List<Entry> = withContext(Dispatchers.IO) {
        OSProcessUtil.getProcessList().map {
            val pid = it.pid.toLong()
            Entry(pid, it.executableName, it.commandLine, start(pid))
        }
    }

    /**
     * Pids in [entries] that are [worktree]'s forked application: a `java`/`javaw` process whose
     * command line references the worktree path, started no earlier than [since] give or take
     * [CLOCK_SLACK] (entries whose start time could not be determined are not excluded on that basis
     * alone), not the IDE's own process, and not on the long-lived-daemon [DENYLIST].
     */
    fun match(worktree: String, since: Instant, entries: List<Entry>): List<Long> {
        val self = ProcessHandle.current().pid()
        val needle = normalize(worktree)
        val floor = since.minus(CLOCK_SLACK)
        // Everything referencing the worktree, before the java/daemon/start-time filters — the useful
        // view when a forked application was expected but nothing was reaped.
        LOG.debug {
            val seen = entries.filter { refers(it.commandLine, needle) }
            "worktree run: scanned ${entries.size} processes, ${seen.size} reference $needle" +
                seen.joinToString("") { "\n  pid=${it.pid} exe=${it.executable} start=${it.start} ${it.commandLine}" }
        }
        return entries.filter { entry ->
            entry.pid != self &&
                isJava(entry.executable) &&
                refers(entry.commandLine, needle) &&
                (entry.start == null || !entry.start.isBefore(floor)) &&
                DENYLIST.none { entry.commandLine.contains(it) }
        }.map { it.pid }
    }

    /**
     * Whether [command] references the [path] directory rather than merely starting with its name.
     * Worktree directories are named after branches, so sibling names commonly share a prefix
     * (`…/worktrees/fix` vs `…/worktrees/fix-2`) and a plain `contains` would let one worktree reap
     * another's application. A reference must therefore end at a path or argument boundary.
     */
    private fun refers(command: String, path: String): Boolean {
        var from = command.indexOf(path)
        while (from >= 0) {
            val after = from + path.length
            if (after == command.length || BOUNDARY.matches(command[after].toString())) return true
            from = command.indexOf(path, from + 1)
        }
        return false
    }

    /** SIGTERM ([force] = false — graceful, lets Spring Boot/JVM shutdown hooks run) or SIGKILL. */
    fun terminate(pids: Collection<Long>, force: Boolean) {
        for (pid in pids) {
            val handle = ProcessHandle.of(pid).orElse(null) ?: continue
            LOG.info("worktree run: ${if (force) "force killing" else "terminating"} orphan app process pid=$pid")
            if (force) handle.destroyForcibly() else handle.destroy()
        }
    }

    /** True once every one of [pids] has exited (or never existed). */
    fun allDead(pids: Collection<Long>): Boolean = pids.all { pid ->
        ProcessHandle.of(pid).map { !it.isAlive }.orElse(true)
    }

    private fun start(pid: Long): Instant? = ProcessHandle.of(pid).flatMap { it.info().startInstant() }.orElse(null)

    private fun isJava(executable: String): Boolean {
        val name = executable.substringAfterLast('/').substringAfterLast('\\').lowercase()
        return name == "java" || name == "javaw" || name == "java.exe" || name == "javaw.exe"
    }

    private fun normalize(path: String): String =
        runCatching { Path.of(path).normalize().toString() }.getOrDefault(path)
}
