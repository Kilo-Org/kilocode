package ai.kilocode.backend.cli

import ai.kilocode.log.KiloLog
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.util.SystemInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.util.zip.ZipInputStream

object KiloRepoCli {
    private const val ARCHIVE = "kilo-cli.zip"
    private val log = KiloLog.create(KiloRepoCli::class.java)

    fun available(): Boolean = KiloRepoCli::class.java.classLoader.getResource(ARCHIVE) != null

    suspend fun extract(force: Boolean): File = extract(
        force = force,
        root = File(PathManager.getSystemPath(), "kilo/repo-cli/${KiloProps.cliVersion()}"),
        cleanup = true,
        source = {
            KiloRepoCli::class.java.classLoader.getResourceAsStream(ARCHIVE)
                ?: throw IllegalStateException("kilo-cli.zip resource not found; rebuild with bundled CLI resources")
        },
    )

    internal suspend fun extract(
        force: Boolean,
        root: File,
        cleanup: Boolean = false,
        source: () -> InputStream,
    ): File = withContext(Dispatchers.IO) {
        val platform = KiloCliPlatform.current()
        val exe = File(root, "$platform/bin/${KiloCliPlatform.exe()}")
        val done = File(root, ".complete")
        if (!force && done.isFile && exe.isFile) {
            if (!SystemInfo.isWindows) exe.setExecutable(true)
            if (cleanup) prune(root)
            return@withContext exe
        }

        if (root.exists() && !root.deleteRecursively()) {
            throw IllegalStateException("Failed to delete local repo CLI under ${root.absolutePath}")
        }
        if (!root.isDirectory && !root.mkdirs()) {
            throw IllegalStateException("Failed to create local repo CLI directory ${root.absolutePath}")
        }

        source().use { input ->
            ZipInputStream(input.buffered()).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    val path = select(root, entry.name, platform)
                    if (path != null) write(root, path, entry.isDirectory) { out -> zip.copyTo(out) }
                    zip.closeEntry()
                }
            }
        }

        if (!exe.isFile) throw IllegalStateException("Bundled CLI archive did not contain $platform/bin/${KiloCliPlatform.exe()}")
        if (!SystemInfo.isWindows) exe.setExecutable(true)
        done.writeText("ok\n")
        if (cleanup) prune(root)
        return@withContext exe
    }

    private fun prune(root: File) {
        val parent = root.parentFile ?: return
        val entries = parent.listFiles() ?: return
        for (entry in entries) {
            if (!entry.isDirectory || entry.name == root.name || entry.name.startsWith(".")) continue
            log.info("Removing stale bundled Kilo CLI version ${entry.absolutePath}")
            if (!entry.deleteRecursively()) {
                log.warn("Failed to remove stale bundled Kilo CLI version ${entry.absolutePath}")
            }
        }
    }

    private fun select(dir: File, name: String, platform: String): String? {
        check(dir, name)
        val path = name.replace('\\', '/')
        val prefix = "$platform/"
        if (path.startsWith(prefix)) return path
        if (path.startsWith("bin/")) return "$platform/$path"
        return null
    }

    private fun check(dir: File, name: String) {
        val raw = name.replace('\\', '/')
        if (raw.startsWith("/")) throw IllegalStateException("Archive entry escapes target directory: $name")
        val parts = raw.split('/').filter { it.isNotEmpty() }
        if (parts.any { it == ".." }) throw IllegalStateException("Archive entry escapes target directory: $name")
        val target = File(dir, name).canonicalFile
        val base = dir.canonicalFile
        if (target != base && !target.path.startsWith(base.path + File.separator)) {
            throw IllegalStateException("Archive entry escapes target directory: $name")
        }
    }

    private fun write(dir: File, name: String, directory: Boolean, copy: (OutputStream) -> Unit) {
        val target = File(dir, name).canonicalFile
        val base = dir.canonicalFile
        if (target != base && !target.path.startsWith(base.path + File.separator)) {
            throw IllegalStateException("Archive entry escapes target directory: $name")
        }
        if (directory) {
            target.mkdirs()
            return
        }
        target.parentFile.mkdirs()
        target.outputStream().use(copy)
        if (!SystemInfo.isWindows && (target.name == "kilo" || target.name == "bwrap")) {
            target.setExecutable(true)
        }
    }
}
