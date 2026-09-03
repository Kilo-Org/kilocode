package ai.kilocode.backend.testing

import java.nio.file.Files
import java.nio.file.Path

/**
 * A real JVM process standing in for the application a delegated worktree run forks — a Gradle
 * `bootRun`/`JavaExec` child — for tests of `WorktreeRunReaper`.
 *
 * It must be a genuine `java` process: the reaper only reaps `java`/`javaw` executables, and a copied
 * shell renamed to `java` is SIGKILLed on sight by macOS code-signing enforcement. Launched in
 * single-file source mode ([JEP 330][1]), with `marker` passed as a program argument so the process
 * command line references the worktree exactly like a forked app's classpath would.
 *
 * [1]: https://openjdk.org/jeps/330
 */
object StubbornJvm {
    /**
     * Exits on SIGTERM, like a well-behaved application. Use when a test needs the reap itself to be
     * observable: the process dying *is* the evidence that it was signalled.
     */
    fun start(marker: String): Process = spawn(marker, hook = false)

    /**
     * Ignores SIGTERM by installing a shutdown hook that never finishes — the realistic bad case the
     * reaper's SIGKILL escalation exists for, and the way to keep an orphan row observable.
     */
    fun stubborn(marker: String): Process = spawn(marker, hook = true)

    private const val HOOK = """
                Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                    try {
                        Thread.sleep(600_000);
                    } catch (InterruptedException ignored) {
                    }
                }));
    """

    private fun source(hook: Boolean) = """
        public class KiloStubbornApp {
            public static void main(String[] args) throws Exception {
                ${if (hook) HOOK.trim() else ""}
                System.out.println("ready");
                System.out.flush();
                Thread.sleep(600_000);
            }
        }
    """.trimIndent()

    /** Returns once the app has printed `ready`, i.e. any shutdown hook is installed. */
    private fun spawn(marker: String, hook: Boolean): Process {
        val dir = Files.createTempDirectory("kilo-stubborn-app")
        val file = dir.resolve("KiloStubbornApp.java")
        Files.writeString(file, source(hook))
        val process = ProcessBuilder(java().toString(), file.toString(), marker)
            .redirectErrorStream(true)
            .start()
        val ready = process.inputStream.bufferedReader().readLine()
        check(ready == "ready") { "stubborn app did not start: $ready" }
        return process
    }

    /** The JVM running the tests, which is a real `java` executable the reaper will accept. */
    private fun java(): Path = Path.of(ProcessHandle.current().info().command().orElseThrow())
}
