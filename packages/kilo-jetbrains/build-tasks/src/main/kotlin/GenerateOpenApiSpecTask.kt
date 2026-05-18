import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.tasks.InputDirectory
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction
import javax.inject.Inject
import org.gradle.process.ExecOperations
import java.io.ByteArrayOutputStream

/**
 * Generates the CLI OpenAPI spec into the build directory so the JetBrains
 * Gradle build is self-contained and does not mutate the tracked
 * packages/sdk/openapi.json.
 *
 * Runs `bun dev generate` from the opencode package directory and captures
 * stdout to [spec]. stderr is captured separately and included in the error
 * message on failure.
 *
 * Gradle up-to-date tracking is scoped to [serverSrcDir] (the opencode server
 * source) to avoid busting the cache on unrelated changes to dist/, node_modules/,
 * etc.
 */
abstract class GenerateOpenApiSpecTask : DefaultTask() {

    /**
     * The server source directory inside the opencode package — the only files
     * that affect the OpenAPI output. Scoped to `src/server/` to avoid busting
     * the Gradle up-to-date check on unrelated file changes (dist/, node_modules/).
     */
    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val serverSrcDir: DirectoryProperty

    /**
     * Root of the `packages/opencode/` package — the working directory for bun.
     * Marked @Internal because it is not itself a Gradle input; only [serverSrcDir]
     * (a subdirectory) participates in up-to-date checking.
     */
    @get:Internal
    abstract val opencodeDir: DirectoryProperty

    /** Destination file for the generated openapi.json. */
    @get:OutputFile
    abstract val spec: RegularFileProperty

    @get:Inject
    abstract val exec: ExecOperations

    @TaskAction
    fun run() {
        val out = ByteArrayOutputStream()
        val err = ByteArrayOutputStream()
        val result = exec.exec {
            workingDir = opencodeDir.get().asFile
            commandLine(findBun(), "run", "--conditions=browser", "./src/index.ts", "generate")
            standardOutput = out
            errorOutput = err
            isIgnoreExitValue = true
        }
        if (result.exitValue != 0) {
            throw GradleException(
                "bun dev generate failed with exit code ${result.exitValue}.\n" +
                err.toString(Charsets.UTF_8).take(2000)
            )
        }
        val json = out.toString(Charsets.UTF_8)
        if (!json.trimStart().startsWith("{")) {
            throw GradleException(
                "bun dev generate did not produce JSON.\n" +
                "stdout: ${json.take(200)}\n" +
                "stderr: ${err.toString(Charsets.UTF_8).take(500)}"
            )
        }
        spec.get().asFile.also { it.parentFile.mkdirs() }.writeText(json)
    }

    private fun findBun(): String {
        val which = runCatching {
            ProcessBuilder("which", "bun")
                .redirectErrorStream(true)
                .start()
                .inputStream.bufferedReader().readLine()?.trim()
        }.getOrNull()
        if (which != null && java.io.File(which).isFile) return which

        val home = System.getProperty("user.home")
        val candidates = listOf(
            "$home/.bun/bin/bun",
            "/opt/homebrew/bin/bun",
            "/usr/local/bin/bun",
            "$home/.nvm/current/bin/bun",
        )
        for (path in candidates) {
            val f = java.io.File(path)
            if (f.isFile && f.canExecute()) return f.absolutePath
        }
        return "bun"
    }
}
