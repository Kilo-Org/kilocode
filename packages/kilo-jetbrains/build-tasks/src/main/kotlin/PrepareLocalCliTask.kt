import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.Optional
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.TaskAction
import org.gradle.process.ExecOperations
import org.gradle.work.DisableCachingByDefault
import java.io.File
import javax.inject.Inject

/**
 * Prepare the local-platform CLI binary for JetBrains backend runs.
 *
 * Runs `bun run build --prepare-cli` from the [root] project directory when
 * the expected current-platform binary is absent from [dir]. Skips
 * immediately when the binary already exists.
 *
 * Bun is found in the following priority order:
 * 1. Explicit `-Pkilo.bun.path=...` Gradle property (forwarded via [bunPath])
 * 2. `BUN_EXE` environment variable (absolute path to the bun executable)
 * 3. `BUN_INSTALL/bin/bun` (from `BUN_INSTALL` environment variable)
 * 4. Each entry on `PATH`
 * 5. Common install locations (`~/.bun/bin`, `/opt/homebrew/bin`, `/usr/local/bin`)
 *
 * After Bun finishes, the task verifies the expected binary and models snapshot exist so that
 * Rosetta / architecture mismatches surface with a clear error message.
 */
@DisableCachingByDefault(because = "Local developer bootstrap task that shells out to Bun")
abstract class PrepareLocalCliTask : DefaultTask() {
    @get:Internal
    abstract val root: DirectoryProperty

    @get:OutputDirectory
    abstract val dir: DirectoryProperty

    @get:Input
    @get:Optional
    abstract val bunPath: Property<String>

    @get:Inject
    abstract val exec: ExecOperations

    @TaskAction
    fun run() {
        val expected = binary()
        val snapshot = snapshot()
        if (expected.exists() && snapshot.exists()) {
            logger.lifecycle("CLI binary already exists at ${expected.absolutePath}")
            return
        }

        val bun = findBun()
        logger.lifecycle("Preparing local CLI binary with ${bun.absolutePath}")
        val result = exec.exec {
            workingDir = root.get().asFile
            executable = bun.absolutePath
            args("run", "build", "--prepare-cli")
            isIgnoreExitValue = true
        }

        if (result.exitValue != 0) {
            throw GradleException("bun run build --prepare-cli failed with exit code ${result.exitValue}")
        }

        if (!expected.exists()) {
            throw GradleException(
                "Expected CLI binary was not created at ${expected.absolutePath}. " +
                    "This can happen if Bun and Gradle are running under different architectures."
            )
        }
        if (!snapshot.exists()) {
            throw GradleException("Expected CLI models snapshot was not created at ${snapshot.absolutePath}.")
        }
    }

    private fun binary(): File {
        return File(File(dir.get().asFile, platform()), exe())
    }

    private fun snapshot(): File {
        return File(File(dir.get().asFile, platform()), "models-snapshot.json")
    }

    private fun platform(): String {
        return "${os()}-${arch()}"
    }

    private fun os(): String {
        val name = System.getProperty("os.name").lowercase()
        if ("mac" in name || "darwin" in name) return "darwin"
        if ("linux" in name) return "linux"
        if ("windows" in name) return "windows"
        throw GradleException("Unsupported OS for JetBrains CLI binary: $name")
    }

    private fun arch(): String {
        return when (val value = System.getProperty("os.arch").lowercase()) {
            "aarch64", "arm64" -> "arm64"
            "x86_64", "amd64" -> "x64"
            else -> throw GradleException("Unsupported architecture for JetBrains CLI binary: $value")
        }
    }

    private fun exe(): String {
        if (os() == "windows") return "kilo.exe"
        return "kilo"
    }

    private fun findBun(): File {
        val configured = bunPath.orNull?.trim()?.takeIf { it.isNotEmpty() }
        if (configured != null) return requireBun(File(configured))

        val names = if (os() == "windows") listOf("bun.exe", "bun.cmd", "bun.bat") else listOf("bun")
        val candidates = mutableListOf<File>()

        System.getenv("BUN_EXE")?.trim()?.takeIf { it.isNotEmpty() }?.let { candidates.add(File(it)) }
        System.getenv("BUN_INSTALL")?.trim()?.takeIf { it.isNotEmpty() }?.let { install ->
            candidates.addAll(names.map { File(File(install, "bin"), it) })
        }
        System.getenv("PATH")?.split(File.pathSeparator)?.forEach { entry ->
            candidates.addAll(names.map { File(entry, it) })
        }

        val home = System.getProperty("user.home")
        candidates.addAll(names.map { File(File(home, ".bun/bin"), it) })
        candidates.addAll(names.map { File("/opt/homebrew/bin", it) })
        candidates.addAll(names.map { File("/usr/local/bin", it) })

        return candidates.firstOrNull(::usable)
            ?: throw GradleException("Could not find Bun. Install Bun or pass -Pkilo.bun.path=/absolute/path/to/bun.")
    }

    private fun requireBun(file: File): File {
        if (usable(file)) return file
        throw GradleException("Configured Bun executable is not usable: ${file.absolutePath}")
    }

    private fun usable(file: File): Boolean {
        if (!file.isFile) return false
        if (os() == "windows") return true
        return file.canExecute()
    }
}
