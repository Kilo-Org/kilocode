import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.Internal
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.TaskAction
import java.net.HttpURLConnection
import java.net.URI
import java.time.Instant

abstract class WriteCliChecksumsTask : DefaultTask() {
    companion object {
        private val DIGEST = Regex("^sha256:[a-f0-9]{64}$")
        private val JSON = Json { ignoreUnknownKeys = true }
        private const val API = "https://api.github.com/repos/Kilo-Org/kilocode/releases/tags"
        // Keep in sync with KiloCliPlatform.current() and StageBundledCliTask.PLATFORMS.
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

    @get:OutputFile
    abstract val checksums: RegularFileProperty

    @TaskAction
    fun run() {
        val ver = cliVersion.get()
        val assets = assets(ver)
        val values = PLATFORMS.associateWith { platform ->
            val name = "kilo-$platform.${ext(platform)}"
            assets[name] ?: throw GradleException("Kilo CLI release $ver did not include $name")
        }

        val out = checksums.get().asFile
        out.parentFile.mkdirs()
        out.writeText(
            values.entries
                .sortedBy { it.key }
                .joinToString(separator = "\n", postfix = "\n") { item -> "${item.key}=${item.value}" }
        )
    }

    private fun assets(ver: String): Map<String, String> {
        val url = "$API/v$ver"
        logger.lifecycle("Fetching pinned Kilo CLI release checksums from $url")
        val conn = connect(url)
        try {
            val code = conn.responseCode
            if (code !in 200..299) fail(conn, code, "Failed to fetch pinned Kilo CLI release checksums")
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
            throw GradleException("GitHub API rate limit exceeded while fetching Kilo CLI checksums ($info)$detail")
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
