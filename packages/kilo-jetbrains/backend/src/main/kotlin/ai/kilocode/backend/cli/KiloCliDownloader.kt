package ai.kilocode.backend.cli

import ai.kilocode.log.KiloLog
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.util.SystemInfo
import com.intellij.util.EnvironmentUtil
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream
import java.io.File
import java.io.RandomAccessFile
import java.nio.channels.FileLock
import java.nio.channels.OverlappingFileLockException
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.zip.ZipInputStream
import kotlin.math.roundToInt

class KiloCliDownloader(
    private val http: OkHttpClient = KiloBackendHttpClients.cliDownload(),
    private val log: KiloLog = KiloLog.create(KiloCliDownloader::class.java),
    private val root: File = File(PathManager.getSystemPath(), "kilo/cli"),
    private val baseUrl: String = "https://github.com/Kilo-Org/kilocode/releases/download",
    private val api: String = "https://api.github.com/repos/Kilo-Org/kilocode/releases/tags",
    private val lockTimeoutMs: Long = LOCK_TIMEOUT_MS,
) {
    companion object {
        private const val LOCK_TIMEOUT_MS = 30_000L
        private const val LOCK_POLL_MS = 100L
        private val DIGEST = Regex("^sha256:[a-f0-9]{64}$")
        private val JSON = Json { ignoreUnknownKeys = true }
        private val LOCKS = ConcurrentHashMap<String, Any>()
    }

    suspend fun resolve(version: String, force: Boolean = false, onProgress: (CliDownload) -> Unit = {}): File =
        withContext(Dispatchers.IO) {
            logPaths(version, force)
            locked {
                val platform = KiloCliPlatform.current()
                val dir = File(File(root, version), platform)
                val exe = File(dir, "bin/${KiloCliPlatform.exe()}")
                val done = File(dir, ".complete")
                val ext = KiloCliPlatform.archive(platform)

                log.info(
                    "Kilo CLI cache target: version=$version platform=$platform exe=${exe.absolutePath} " +
                        "complete=${done.absolutePath} force=$force"
                )

                if (!force) {
                    cached(version, platform, exe, done)?.let { return@locked it }
                }

                val digest = asset(version, platform, ext)
                val stage = stage(version, platform)
                try {
                    val archive = File(stage, "kilo-$platform.$ext")
                    val staged = File(stage, "bin/${KiloCliPlatform.exe()}")
                    val complete = File(stage, ".complete")

                    log.info(
                        "Kilo CLI $version for $platform is not cached; downloading new release into ${stage.absolutePath}"
                    )
                    onProgress(CliDownload(0, version, platform))
                    download(version, platform, ext, archive, onProgress)
                    log.info("Verifying Kilo CLI archive ${archive.absolutePath}")
                    verify(archive, digest)
                    log.info(
                        "Downloaded Kilo CLI $version for $platform to ${archive.absolutePath} (size=${archive.length()} bytes)"
                    )
                    extract(archive, stage)
                    if (!staged.isFile) {
                        throw IllegalStateException("Downloaded CLI archive did not contain bin/${KiloCliPlatform.exe()}")
                    }
                    if (!SystemInfo.isWindows) staged.setExecutable(true)
                    if (archive.exists() && !archive.delete()) {
                        log.warn("Failed to delete extracted Kilo CLI archive ${archive.absolutePath}")
                    }
                    log.info("Writing Kilo CLI cache completion marker ${complete.absolutePath}")
                    complete.writeText("$digest\n")
                    replace(dir, stage)
                    onProgress(CliDownload(100, version, platform))
                    prune(version)
                    exe
                } finally {
                    if (stage.exists() && !stage.deleteRecursively()) {
                        log.warn("Failed to delete staged Kilo CLI download ${stage.absolutePath}")
                    }
                }
            }
        }

    private fun cached(version: String, platform: String, exe: File, done: File): File? {
        val digest = done.takeIf { it.isFile }?.readText()?.trim()
        val valid = digest != null && digest.matches(DIGEST)
        log.info(
            "Kilo CLI cache check: version=$version platform=$platform exeExists=${exe.isFile} " +
                "completeExists=${done.isFile} digestValid=$valid exe=${exe.absolutePath} complete=${done.absolutePath}"
        )
        if (!exe.isFile || !valid) return null
        log.info("Using cached Kilo CLI $version for $platform at ${exe.absolutePath}")
        if (!SystemInfo.isWindows) exe.setExecutable(true)
        prune(version)
        return exe
    }

    private fun <T> locked(block: () -> T): T {
        log.info("Ensuring Kilo CLI cache root ${root.absolutePath}")
        if (!root.isDirectory && !root.mkdirs()) {
            throw IllegalStateException("Failed to create Kilo CLI cache root ${root.absolutePath}")
        }
        val file = File(root, ".lock").canonicalFile
        log.info("Kilo CLI cache lock path: ${file.absolutePath}")
        val mutex = LOCKS.computeIfAbsent(file.absolutePath) { Any() }
        return synchronized(mutex) {
            RandomAccessFile(file, "rw").channel.use { channel ->
                val start = System.nanoTime()
                log.info("Waiting for Kilo CLI cache lock: ${file.absolutePath}")
                val lock = acquire(file, channel::tryLock, start)
                lock.use {
                    log.info("Acquired Kilo CLI cache lock after ${elapsed(start)}ms: ${file.absolutePath}")
                    block()
                }
            }
        }
    }

    private fun acquire(file: File, attempt: () -> FileLock?, start: Long): FileLock {
        while (true) {
            val lock = try {
                attempt()
            } catch (_: OverlappingFileLockException) {
                null
            }
            if (lock != null) return lock
            val waited = elapsed(start)
            if (waited >= lockTimeoutMs) {
                val msg = "Timed out waiting for Kilo CLI cache lock after ${waited}ms: ${file.absolutePath}"
                log.warn(msg)
                throw IllegalStateException(msg)
            }
            Thread.sleep(LOCK_POLL_MS.coerceAtMost((lockTimeoutMs - waited).coerceAtLeast(1L)))
        }
    }

    private fun elapsed(start: Long): Long = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)

    private fun stage(version: String, platform: String): File {
        val tmp = File(root, ".tmp")
        val dir = File(tmp, "$version-$platform-${System.nanoTime()}")
        log.info("Creating Kilo CLI staging directory ${dir.absolutePath}")
        if (!dir.isDirectory && !dir.mkdirs()) {
            throw IllegalStateException("Failed to create Kilo CLI staging directory ${dir.absolutePath}")
        }
        return dir
    }

    private fun replace(dir: File, stage: File) {
        log.info("Installing Kilo CLI cache from ${stage.absolutePath} to ${dir.absolutePath}")
        val parent = dir.parentFile
        if (!parent.isDirectory && !parent.mkdirs()) {
            throw IllegalStateException("Failed to create Kilo CLI cache directory ${parent.absolutePath}")
        }

        val backup = File(parent, ".${dir.name}.backup-${System.nanoTime()}")
        if (dir.exists() && !dir.renameTo(backup)) {
            throw IllegalStateException("Failed to move existing Kilo CLI cache ${dir.absolutePath} aside")
        }
        if (stage.renameTo(dir)) {
            log.info("Installed Kilo CLI cache at ${dir.absolutePath}")
            if (backup.exists() && !backup.deleteRecursively()) {
                log.warn("Failed to delete previous Kilo CLI cache ${backup.absolutePath}")
            }
            return
        }

        if (backup.exists() && !backup.renameTo(dir)) {
            log.warn("Failed to restore previous Kilo CLI cache ${backup.absolutePath} to ${dir.absolutePath}")
        }
        throw IllegalStateException("Failed to install Kilo CLI cache ${stage.absolutePath} to ${dir.absolutePath}")
    }

    private fun fail(message: String): Nothing {
        log.warn(message)
        throw IllegalStateException(message)
    }

    private fun asset(version: String, platform: String, ext: String): String {
        val name = "kilo-$platform.$ext"
        val url = "${api.trimEnd('/')}/v$version"
        log.info("Fetching Kilo CLI release metadata for $version from $url")
        val request = Request.Builder()
            .url(url)
            .header("Accept", "application/vnd.github+json")
            .build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                val info = rate(response)
                val body = runCatching { response.body?.string() }.getOrNull()?.take(500)
                val detail = if (body.isNullOrBlank()) "" else ": $body"
                if (limited(response)) {
                    log.warn("GitHub API rate limit hit fetching Kilo CLI $version metadata from $url ($info)$detail")
                    throw IllegalStateException(
                        "GitHub API rate limit exceeded while resolving Kilo CLI $version ($info)$detail"
                    )
                }
                log.warn("Failed to fetch Kilo CLI $version metadata from $url: HTTP ${response.code} ($info)$detail")
                throw IllegalStateException(
                    "Failed to fetch Kilo CLI release metadata for $version: HTTP ${response.code} ($info)$detail"
                )
            }
            log.debug { "GitHub metadata OK for Kilo CLI $version (${rate(response)})" }
            val body = response.body?.string()
                ?: throw IllegalStateException("Failed to fetch Kilo CLI release metadata for $version: empty response body")
            val assets = JSON.parseToJsonElement(body).jsonObject["assets"]?.jsonArray
            val entry = assets?.firstOrNull { it.jsonObject["name"]?.jsonPrimitive?.contentOrNull == name }
            if (entry == null) {
                val names = assets?.mapNotNull { it.jsonObject["name"]?.jsonPrimitive?.contentOrNull }?.joinToString(", ")
                fail("Kilo CLI release $version has no asset named $name (available assets: ${names ?: "none"})")
            }
            val digest = entry.jsonObject["digest"]?.jsonPrimitive?.contentOrNull
            if (digest == null) {
                fail("Kilo CLI release $version asset $name has no digest yet; GitHub has not published a SHA-256 checksum for it")
            }
            if (!digest.matches(DIGEST)) {
                fail("Kilo CLI release $version asset $name has a malformed digest '$digest'; expected sha256:<64 hex chars>")
            }
            return digest
        }
    }

    private fun rate(response: Response): String {
        val reset = response.header("X-RateLimit-Reset")
            ?.toLongOrNull()
            ?.let { Instant.ofEpochSecond(it).toString() }
        return "limit=${response.header("X-RateLimit-Limit")} remaining=${response.header("X-RateLimit-Remaining")} " +
            "used=${response.header("X-RateLimit-Used")} reset=$reset retryAfter=${response.header("Retry-After")}"
    }

    private fun limited(response: Response) =
        response.code == 429 || (response.code == 403 && response.header("X-RateLimit-Remaining") == "0")

    private fun download(version: String, platform: String, ext: String, file: File, onProgress: (CliDownload) -> Unit) {
        val url = url(version, platform, ext)
        log.info("Downloading Kilo CLI $version for $platform from $url")
        val request = Request.Builder().url(url).build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IllegalStateException("Failed to download Kilo CLI $version for $platform: HTTP ${response.code}")
            }
            val body = response.body ?: throw IllegalStateException("Failed to download Kilo CLI $version: empty response body")
            val total = body.contentLength()
            var read = 0L
            var last = 0
            file.outputStream().use { output ->
                body.byteStream().use { input ->
                    val buffer = ByteArray(8 * 1024)
                    while (true) {
                        val n = input.read(buffer)
                        if (n < 0) break
                        output.write(buffer, 0, n)
                        read += n
                        if (total > 0) {
                            val pct = ((read.toDouble() / total.toDouble()) * 100.0).roundToInt().coerceIn(0, 100)
                            if (pct != last) {
                                last = pct
                                onProgress(CliDownload(pct, version, platform))
                            }
                        }
                    }
                }
            }
        }
    }

    private fun verify(file: File, digest: String) {
        val actual = sum(file)
        if (actual == digest) return
        if (file.exists() && !file.delete()) log.warn("Failed to delete invalid Kilo CLI archive ${file.absolutePath}")
        throw IllegalStateException("Kilo CLI archive digest mismatch for ${file.name}: expected $digest, got $actual")
    }

    private fun sum(file: File) = "sha256:${sha256(file)}"

    private fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
            val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                md.update(buffer, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
    }

    private fun extract(file: File, dir: File) {
        log.info("Extracting Kilo CLI archive ${file.absolutePath}")
        if (file.name.endsWith(".zip")) {
            ZipInputStream(file.inputStream().buffered()).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    write(dir, entry.name, entry.isDirectory) { out -> zip.copyTo(out) }
                    zip.closeEntry()
                }
            }
            return
        }

        TarArchiveInputStream(GzipCompressorInputStream(file.inputStream().buffered())).use { tar ->
            while (true) {
                val entry = tar.nextEntry ?: break
                write(dir, entry.name, entry.isDirectory) { out -> tar.copyTo(out) }
            }
        }
    }

    private fun write(dir: File, name: String, directory: Boolean, copy: (java.io.OutputStream) -> Unit) {
        val path = if (name.startsWith("bin/")) name else "bin/$name"
        val target = File(dir, path).canonicalFile
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

    /**
     * Delete every cached CLI version under [root] except [keep]. Each plugin update pins a new
     * CLI version, so without this old versions would accumulate in the IDE system directory
     * indefinitely. Runs only after the active version resolved successfully so a failed download
     * never wipes the last working copy.
     */
    private fun prune(keep: String) {
        val entries = root.listFiles() ?: return
        for (entry in entries) {
            if (!entry.isDirectory || entry.name == keep || entry.name.startsWith(".")) continue
            log.info("Removing stale Kilo CLI version ${entry.absolutePath}")
            if (!entry.deleteRecursively()) {
                log.warn("Failed to remove stale Kilo CLI version ${entry.absolutePath}")
            }
        }
    }

    private fun url(version: String, platform: String, ext: String) =
        "${baseUrl.trimEnd('/')}/v$version/kilo-$platform.$ext"

    private fun logPaths(version: String, force: Boolean) {
        val text = buildList {
            add("version=$version force=$force")
            add("configPath=${safe { PathManager.getConfigPath() }}")
            add("systemPath=${safe { PathManager.getSystemPath() }}")
            add("pluginsPath=${safe { PathManager.getPluginsPath() }}")
            add("logPath=${safe { PathManager.getLogPath() }}")
            add("logDir=${safe { PathManager.getLogDir().toString() }}")
            add("idea.config.path=${safe { System.getProperty("idea.config.path") ?: "<unset>" }}")
            add("idea.system.path=${safe { System.getProperty("idea.system.path") ?: "<unset>" }}")
            add("idea.plugins.path=${safe { System.getProperty("idea.plugins.path") ?: "<unset>" }}")
            add("idea.log.path=${safe { System.getProperty("idea.log.path") ?: "<unset>" }}")
            add("idea.properties.file=${safe { System.getProperty("idea.properties.file") ?: "<unset>" }}")
            add("user.home=${safe { System.getProperty("user.home") ?: "<unset>" }}")
            add("USERPROFILE=${safe { EnvironmentUtil.getValue("USERPROFILE") ?: "<unset>" }}")
            add("TEMP=${safe { EnvironmentUtil.getValue("TEMP") ?: "<unset>" }}")
            add("TMP=${safe { EnvironmentUtil.getValue("TMP") ?: "<unset>" }}")
            add("cacheRoot=${safe { root.absolutePath + info(root) }}")
        }.joinToString(" ")
        log.info("Kilo CLI path diagnostics: $text")
    }

    private fun info(file: File): String = runCatching {
        val path = existing(file.toPath())
        val store = Files.getFileStore(path)
        " (canonical=${file.canonicalPath} fs=${store.type().ifBlank { "<unknown>" }} " +
            "name=${store.name().ifBlank { "<unknown>" }} readOnly=${store.isReadOnly})"
    }.getOrElse { " (canonical=<unavailable: ${it.message}> fs=<unavailable>)" }

    private fun existing(path: Path): Path {
        var current = path
        while (!Files.exists(current) && current.parent != null) current = current.parent
        return current
    }

    private fun safe(value: () -> String): String = runCatching { value() }.getOrElse { "<unavailable: ${it.message}>" }
}
