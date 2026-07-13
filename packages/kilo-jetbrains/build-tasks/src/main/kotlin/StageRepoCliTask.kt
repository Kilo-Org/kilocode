import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.TaskAction
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

abstract class StageRepoCliTask : DefaultTask() {
    @get:Internal
    abstract val bin: DirectoryProperty

    @get:OutputFile
    abstract val archive: RegularFileProperty

    @TaskAction
    fun run() {
        val dir = bin.asFile.get()
        val exe = File(dir, exe())
        if (!exe.isFile) {
            throw GradleException(
                "Repo CLI binary not found at ${exe.absolutePath}. Run ./gradlew :backend:buildRepoCli " +
                    "(or bun run script/build.ts --single --skip-install in packages/opencode) first."
            )
        }

        val out = archive.get().asFile
        out.parentFile.mkdirs()
        ZipOutputStream(out.outputStream().buffered()).use { zip ->
            dir.walkTopDown()
                .filter { it.isFile }
                .forEach { file ->
                    val name = "bin/${file.relativeTo(dir).invariantSeparatorsPath}"
                    zip.putNextEntry(ZipEntry(name))
                    file.inputStream().use { it.copyTo(zip) }
                    zip.closeEntry()
                }
        }
    }

    private fun exe() = if (System.getProperty("os.name").lowercase().contains("windows")) "kilo.exe" else "kilo"
}
