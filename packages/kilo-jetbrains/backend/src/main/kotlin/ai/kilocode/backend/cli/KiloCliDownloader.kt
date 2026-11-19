package ai.kilocode.backend.cli

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import java.io.InputStream
import java.net.URL
import java.nio.channels.FileChannel
import java.nio.channels.FileLock
import java.nio.channels.OverlappingFileLockException
import java.nio.file.Files
import java.nio.file.LinkOption.NOFOLLOW_LINKS
import java.nio.file.Path
import java.nio.file.StandardOpenOption.CREATE
import java.nio.file.StandardOpenOption.WRITE
import java.security.DigestInputStream
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream

/** Install the pinned npm platform package with its runtime sidecars on the machine running the IDE backend. */
internal class KiloCliDownloader(
    private val root: Path,
    private val http: OkHttpClient = OkHttpClient.Builder().followSslRedirects(false).callTimeout(5, TimeUnit.MINUTES).build(),
    private val bundled: (CliPin) -> URL? = { it.bundled },
) {
    suspend fun resolve(pin: CliPin, env: Map<String, String>, force: Boolean, progress: (Int) -> Unit): Path =
        withContext(Dispatchers.IO) {
            Files.createDirectories(root)
            // Two backend JVMs may share a system directory. Never expose a half-extracted installation.
            FileChannel.open(root.resolve(".lock"), CREATE, WRITE).use { channel ->
                acquire(channel).use { install(pin, env, force, progress) }
            }
        }

    private suspend fun acquire(channel: FileChannel): FileLock {
        val deadline = System.nanoTime() + TimeUnit.MINUTES.toNanos(5)
        while (true) {
            val lock = try { channel.tryLock() } catch (_: OverlappingFileLockException) { null }
            if (lock != null) return lock
            check(System.nanoTime() < deadline) { "Timed out waiting for the Kilo CLI cache lock" }
            delay(100)
        }
    }

    private suspend fun install(pin: CliPin, env: Map<String, String>, force: Boolean, progress: (Int) -> Unit): Path {
        val parent = Files.createDirectories(root.resolve(pin.version))
        val dir = parent.resolve(pin.platform)
        val exe = dir.resolve("bin").resolve(pin.executable)
        val complete = dir.resolve(".complete")
        if (!force && Files.isRegularFile(dir.resolve("LICENSE"), NOFOLLOW_LINKS) &&
            Files.isRegularFile(complete, NOFOLLOW_LINKS) && Files.readString(complete) == pin.integrity &&
            Files.isRegularFile(exe, NOFOLLOW_LINKS) && validVersion(exe, pin.version, env)) return exe

        val stage = Files.createTempDirectory(parent, ".install-")
        try {
            val archive = stage.resolve("package.tgz")
            download(pin, archive, progress)
            extract(archive, stage)
            check(Files.isRegularFile(stage.resolve("LICENSE"), NOFOLLOW_LINKS)) { "CLI archive is missing its LICENSE" }
            Files.delete(archive)
            val staged = stage.resolve("bin").resolve(pin.executable)
            check(Files.isRegularFile(staged, NOFOLLOW_LINKS) && validVersion(staged, pin.version, env)) {
                "Package did not provide an executable ${pin.executable} reporting kilo2 v${pin.version}"
            }
            Files.writeString(stage.resolve(".complete"), pin.integrity)
            replace(dir, stage)
            root.toFile().listFiles().orEmpty().filter {
                it.isDirectory && it.name != pin.version && it.name.matches(Regex("0\\.0\\.0-v2-[0-9]+"))
            }.forEach { it.deleteRecursively() }
            progress(100)
            return exe
        } finally {
            stage.toFile().deleteRecursively()
        }
    }

    private suspend fun download(pin: CliPin, file: Path, progress: (Int) -> Unit) {
        progress(0)
        val archive = bundled(pin)
        if (archive != null) {
            val resource = archive.openConnection().apply { useCaches = false }
            resource.getInputStream().use { copyVerified(it, resource.contentLengthLong, pin, file, progress) }
            return
        }
        val call = http.newCall(Request.Builder().url(pin.tarball).build())
        call.execute().use { response ->
            check(response.isSuccessful) { "Kilo CLI download returned HTTP ${response.code}" }
            copyVerified(response.body.byteStream(), response.body.contentLength(), pin, file, progress)
        }
    }

    private suspend fun copyVerified(stream: InputStream, total: Long, pin: CliPin, file: Path, progress: (Int) -> Unit) {
        val hash = MessageDigest.getInstance("SHA-512")
        var bytes = 0L
        var last = 0
        DigestInputStream(stream, hash).use { input ->
            Files.newOutputStream(file).use { out ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    currentCoroutineContext().ensureActive()
                    val n = input.read(buffer)
                    if (n < 0) break
                    out.write(buffer, 0, n)
                    bytes += n
                    val percent = if (total > 0) (100 * bytes / total).coerceAtMost(99).toInt() else 0
                    if (percent != last) progress(percent)
                    last = percent
                }
            }
        }
        check("sha512-${Base64.getEncoder().encodeToString(hash.digest())}" == pin.integrity) {
            "Kilo CLI ${pin.version} (${pin.platform}) archive checksum mismatch"
        }
    }

    private suspend fun extract(archive: Path, stage: Path) {
        TarArchiveInputStream(GZIPInputStream(Files.newInputStream(archive).buffered())).use { tar ->
            while (true) {
                currentCoroutineContext().ensureActive()
                val entry = tar.nextEntry ?: break
                val name = entry.name.removeSuffix("/")
                check(!name.startsWith('/') && '\\' !in name && ':' !in name && ".." !in name.split('/')) {
                    "Invalid CLI archive path"
                }
                if (name != "package/LICENSE" && !name.startsWith("package/bin/")) continue
                val target = stage.resolve(name.removePrefix("package/"))
                when {
                    entry.isDirectory -> Files.createDirectories(target)
                    entry.isFile && !entry.isLink && !entry.isSymbolicLink -> {
                        Files.createDirectories(target.parent)
                        Files.copy(tar, target)
                        if (entry.mode and 0b001001001 != 0) target.toFile().setExecutable(true, true)
                    }
                    else -> error("Unsupported entry in CLI archive: $name")
                }
            }
        }
    }

    private fun replace(dir: Path, stage: Path) {
        val previous = if (Files.exists(dir)) Files.move(dir, dir.resolveSibling(".previous-${UUID.randomUUID()}")) else null
        try {
            Files.move(stage, dir)
        } catch (e: Exception) {
            if (previous != null) Files.move(previous, dir)
            throw e
        }
        previous?.toFile()?.deleteRecursively()
    }

    private suspend fun validVersion(exe: Path, version: String, env: Map<String, String>): Boolean = runInterruptible {
        val process = try {
            ProcessBuilder(exe.toString(), "--version").directory(exe.parent.toFile()).apply {
                environment().clear()
                environment().putAll(env)
                redirectError(ProcessBuilder.Redirect.DISCARD)
            }.start()
        } catch (_: java.io.IOException) { return@runInterruptible false }
        try {
            process.outputStream.close()
            process.waitFor(20, TimeUnit.SECONDS) && process.exitValue() == 0 &&
                process.inputStream.use { String(it.readNBytes(512), Charsets.UTF_8).trim() == "kilo2 v$version" }
        } finally {
            if (process.isAlive) process.destroyForcibly()
        }
    }
}
