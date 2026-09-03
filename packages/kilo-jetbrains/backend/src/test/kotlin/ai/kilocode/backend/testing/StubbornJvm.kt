package ai.kilocode.backend.testing

import java.nio.file.Files
import java.nio.file.Path

/**
 * A real JVM process that stands in for the application a delegated worktree run forks — a Gradle
 * `bootRun`/`JavaExec` child — for tests of `WorktreeRunReaper`.
 *
 * It must be a genuine `java` process: the reaper only reaps `java`/`javaw` executables, and a copied
 * shell renamed to `java` is SIGKILLed on sight by macOS code-signing enforcement. Launched in
 * single-file source mode ([java][1] compiles it in memory), with [marker] passed as a program
 * argument so the process command line references the worktree exactly like a forked app's classpath
 * would.
 *
 * The app installs a shutdown hook that never finishes, so it survives SIGTERM. That is the realistic
 * bad case the reaper's escalation exists for: an app whose graceful shutdown hangs.
 *
 * [1]: https://openjdk.org/jeps/330
 */
object StubbornJvm {
    private const val SOURCE = """
        public class KiloStubbornApp {
            public static void main(String[] args) throws Exception {
                Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                    try {
                        Thread.sleep(600_000);
                    } catch (InterruptedException ignored) {
                    }
                }));
                System.out.println("ready");
                System.out.flush();
                Thread.sleep(600_000);
            }
        }
    """

    /** Starts the app and returns once it has printed `ready`, i.e. its shutdown hook is installed. */
    fun start(marker: String): Process {
        val source = Files.createTempDirectory("kilo-stubborn-app").resolve("KiloStubbornApp.java")
        Files.writeString(source, SOURCE.trimIndent())
        val process = ProcessBuilder(java().toString(), source.toString(), marker)
            .redirectErrorStream(true)
            .start()
        val ready = process.inputStream.bufferedReader().readLine()
        check(ready == "ready") { "stubborn app did not start: $ready" }
        return process
    }

    /** The JVM running the tests, which is a real `java` executable the reaper will accept. */
    private fun java(): Path = Path.of(ProcessHandle.current().info().command().orElseThrow())
}
