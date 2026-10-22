import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.TaskAction
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.security.MessageDigest
import java.time.Instant
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

abstract class StageBundledCliTask : DefaultTask() {
    companion object {
        private val DIGEST = Regex("^sha256:[a-f0-9]{64}$")
        private val JSON = Json { ignoreUnknownKeys = true }
        private const val API = "https://api.github.com/repos/Kilo-Org/kilocode/releases/tags"
        private val PLATFORMS = listOf(
            "darwin-arm64",
            "darwin-x64",
            "linux-arm64",
            "linux-x64",
            "windows-arm64",
            "windows-x64",
        )
    }

    @get:Input
    abstract val cliVersion: Property<String>

    @get:Internal
    abstract val token: Property<String>

    @get:Internal
    abstract val cacheDir: DirectoryProperty

    @get:OutputFile
    abstract val archive: RegularFileProperty

    @TaskAction
    fun run() {
        val ver = cliVersion.get()
        val assets = assets(ver)
        val files = PLATFORMS.associateWith { platform ->
            val ext = ext(platform)
            val name = "kilo-$platform.$ext"
            val digest = assets[name] ?: throw GradleException("Kilo CLI release $ver did not include $name")
            val file = cacheDir.dir(ver).map { it.dir(platform).file(name) }.get().asFile
            fetch(ver, platform, name, digest, file)
            file
        }

        val out = archive.get().asFile
        out.parentFile.mkdirs()
        ZipOutputStream(out.outputStream().buffered()).use { zip ->
            for ((platform, file) in files) {
                if (file.name.endsWith(".zip")) {
                    zip(platform, file, zip)
                    continue
                }
                tar(platform, file, zip)
            }
        }
    }

    private fun assets(ver: String): Map<String, String> {
        val url = "$API/v$ver"
        logger.lifecycle("Fetching pinned Kilo CLI release metadata from $url")
        val conn = connect(url)
        try {
            val code = conn.responseCode
            if (code !in 200..299) fail(conn, code, "Failed to fetch pinned Kilo CLI release metadata")
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            return JSON.parseToJsonElement(body).jsonObject["assets"]?.jsonArray
                ?.associate { item ->
                    val obj = item.jsonObject
                    val name = obj["name"]?.jsonPrimitive?.contentOrNull
                    val digest = obj["digest"]?.jsonPrimitive?.contentOrNull
                    if (name.isNullOrBlank() || digest.isNullOrBlank()) return@associate "" to ""
                    name to digest
                }
                ?.filter { it.key.isNotEmpty() }
                ?.mapValues { item ->
                    val digest = item.value
                    if (!digest.matches(DIGEST)) {
                        throw GradleException("Pinned Kilo CLI release $ver asset ${item.key} has invalid digest")
                    }
                    digest
                }
                ?: emptyMap()
        } finally {
            conn.disconnect()
        }
    }

    private fun fetch(ver: String, platform: String, name: String, digest: String, file: File) {
        if (file.isFile && sum(file) == digest) return
        file.parentFile.mkdirs()
        val url = "https://github.com/Kilo-Org/kilocode/releases/download/v$ver/$name"
        logger.lifecycle("Downloading pinned Kilo CLI $platform from $url")
        val conn = connect(url)
        try {
            val code = conn.responseCode
            if (code !in 200..299) fail(conn, code, "Failed to download pinned Kilo CLI $platform")
            conn.inputStream.use { input ->
                file.outputStream().use { output -> input.copyTo(output) }
            }
        } finally {
            conn.disconnect()
        }
        verify(file, digest)
    }

    private fun zip(platform: String, file: File, out: ZipOutputStream) {
        ZipInputStream(file.inputStream().buffered()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                if (!entry.isDirectory) write(out, platform, entry.name) { zip.copyTo(out) }
                zip.closeEntry()
            }
        }
    }

    private fun tar(platform: String, file: File, out: ZipOutputStream) {
        TarArchiveInputStream(GzipCompressorInputStream(file.inputStream().buffered())).use { tar ->
            while (true) {
                val entry = tar.nextEntry ?: break
                if (entry.isDirectory) continue
                if (entry.isSymbolicLink || !entry.isFile) {
                    throw GradleException("Unsupported CLI tar entry type in ${file.name}: ${entry.name}")
                }
                write(out, platform, entry.name) { tar.copyTo(out) }
            }
        }
    }

    private fun write(out: ZipOutputStream, platform: String, name: String, copy: () -> Unit) {
        out.putNextEntry(ZipEntry(path(platform, name)))
        copy()
        out.closeEntry()
    }

    private fun path(platform: String, name: String): String {
        val raw = name.replace('\\', '/')
        if (raw.startsWith("/")) throw GradleException("Archive entry escapes target directory: $name")
        val parts = raw.split('/').filter { it.isNotEmpty() && it != "." }
        if (parts.isEmpty()) throw GradleException("Archive entry is empty: $name")
        if (parts.any { it == ".." }) throw GradleException("Archive entry escapes target directory: $name")
        val path = if (parts.first() == "bin") parts else listOf("bin") + parts
        return "$platform/${path.joinToString("/")}"
    }

    private fun verify(file: File, digest: String) {
        val actual = sum(file)
        if (actual == digest) return
        if (file.exists() && !file.delete()) logger.warn("Failed to delete invalid pinned Kilo CLI archive ${file.absolutePath}")
        throw GradleException("Pinned Kilo CLI archive digest mismatch for ${file.name}: expected $digest, got $actual")
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

    private fun connect(url: String): HttpURLConnection {
        val conn = URI(url).toURL().openConnection() as HttpURLConnection
        conn.connectTimeout = 30_000
        conn.readTimeout = 120_000
        conn.instanceFollowRedirects = true
        conn.setRequestProperty("Accept", "application/vnd.github+json")
        token.getOrNull()
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?.let { conn.setRequestProperty("Authorization", "Bearer $it") }
        return conn
    }

    private fun fail(conn: HttpURLConnection, code: Int, msg: String): Nothing {
        val info = rate(conn)
        val body = runCatching { conn.errorStream?.bufferedReader()?.use { it.readText() } }
            .getOrNull()
            ?.take(500)
        val detail = if (body.isNullOrBlank()) "" else ": $body"
        if (limited(conn, code)) {
            throw GradleException("GitHub API rate limit exceeded while staging bundled Kilo CLI ($info)$detail")
        }
        throw GradleException("$msg: HTTP $code from ${conn.url} ($info)$detail")
    }

    private fun rate(conn: HttpURLConnection): String {
        val reset = conn.getHeaderField("X-RateLimit-Reset")
            ?.toLongOrNull()
            ?.let { Instant.ofEpochSecond(it).toString() }
        return "limit=${conn.getHeaderField("X-RateLimit-Limit")} remaining=${conn.getHeaderField("X-RateLimit-Remaining")} " +
            "used=${conn.getHeaderField("X-RateLimit-Used")} reset=$reset retryAfter=${conn.getHeaderField("Retry-After")}"
    }

    private fun limited(conn: HttpURLConnection, code: Int) =
        code == 429 || (code == 403 && conn.getHeaderField("X-RateLimit-Remaining") == "0")

    private fun ext(platform: String) = if (platform.startsWith("linux-")) "tar.gz" else "zip"
}
