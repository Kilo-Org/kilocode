import org.gradle.api.DefaultTask
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.TaskAction
import org.gradle.process.ExecOperations
import java.io.File
import javax.inject.Inject

abstract class PrepareLocalCliTask : DefaultTask() {
    @get:InputFile
    abstract val script: RegularFileProperty

    @get:Internal
    abstract val root: DirectoryProperty

    @get:OutputDirectory
    abstract val out: DirectoryProperty

    @get:Input
    abstract val platform: Property<String>

    @get:Input
    abstract val exe: Property<String>

    @get:Inject
    abstract val exec: ExecOperations

    @TaskAction
    fun run() {
        val bin = out.file("${platform.get()}/${exe.get()}").get().asFile
        if (bin.exists()) return
        exec.exec {
            workingDir = root.get().asFile
            commandLine(findBun(), "script/build.ts", "--prepare-cli")
        }
    }

    /**
     * Resolve the absolute path to `bun`. The Gradle daemon's PATH is often
     * stripped down and doesn't include Homebrew or user-local bin dirs.
     * Probe common install locations so the build works without manual PATH setup.
     */
    private fun findBun(): String {
        // 1. Already on PATH?
        val which = runCatching {
            ProcessBuilder("which", "bun")
                .redirectErrorStream(true)
                .start()
                .inputStream.bufferedReader().readLine()?.trim()
        }.getOrNull()
        if (which != null && File(which).isFile) return which

        // 2. Common install locations
        val home = System.getProperty("user.home")
        val candidates = listOf(
            "$home/.bun/bin/bun",
            "/opt/homebrew/bin/bun",
            "/usr/local/bin/bun",
            "$home/.nvm/current/bin/bun",
        )
        for (path in candidates) {
            val f = File(path)
            if (f.isFile && f.canExecute()) return f.absolutePath
        }

        // 3. Fall back — let the OS resolve it (will fail with a clear message)
        return "bun"
    }
}
