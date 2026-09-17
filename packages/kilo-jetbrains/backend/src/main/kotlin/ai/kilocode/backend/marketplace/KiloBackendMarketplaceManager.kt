package ai.kilocode.backend.marketplace

import ai.kilocode.backend.app.KiloBackendAppService
import ai.kilocode.log.KiloLog
import ai.kilocode.rpc.dto.MarketplaceItemDto
import ai.kilocode.rpc.dto.MarketplaceListDto
import ai.kilocode.rpc.dto.MarketplaceMethodDto
import ai.kilocode.rpc.dto.MarketplaceParamDto
import ai.kilocode.rpc.dto.MarketplaceResultDto
import com.intellij.openapi.components.service
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.nio.file.FileSystems
import java.nio.file.FileVisitResult
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.SimpleFileVisitor
import java.nio.file.attribute.BasicFileAttributes

/**
 * Talks to the CLI's marketplace routes (`/kilocode/marketplace*`), which fetch the remote
 * catalog and own install/remove filesystem writes. This manager only proxies the local CLI
 * over authenticated HTTP; it never reaches api.kilo.ai directly.
 */
class KiloBackendMarketplaceManager(private val backend: KiloBackendAppService? = null) {
    private val app: KiloBackendAppService get() = backend ?: service()

    suspend fun list(directory: String): MarketplaceListDto {
        val text = request(directory, PATH_LIST, null)
        val root = JSON.parseToJsonElement(text).jsonObject
        val items = root["items"]?.jsonArray.orEmpty()
        val installed = root["installed"]?.jsonObject
        val project = installedKeys(installed?.get("project"))
        val global = installedKeys(installed?.get("global"))
        val errors = root["errors"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()
        val decoded = items.mapNotNull { element ->
            runCatching { element.jsonObject.toDecoded(project, global) }.onFailure { err ->
                LOG.warn("marketplace item decode failed", err)
            }.getOrNull()
        }
        val relevant = withContext(Dispatchers.IO) { relevantKeys(directory, decoded) }
        val dtos = decoded.map { if (it.key in relevant) it.item.copy(relevant = true) else it.item }
        LOG.info("marketplace list dir=$directory items=${dtos.size} errors=${errors.size}")
        return MarketplaceListDto(items = dtos, errors = errors)
    }

    suspend fun install(
        directory: String,
        item: MarketplaceItemDto,
        target: String,
        parameters: Map<String, String>,
    ): MarketplaceResultDto {
        val content = JSON.parseToJsonElement(item.content)
        val payload = buildJsonObject {
            put(
                "item",
                buildJsonObject {
                    put("type", item.type)
                    put("id", item.id)
                    put("content", content)
                },
            )
            put("target", target)
            if (parameters.isNotEmpty()) {
                put("parameters", buildJsonObject { parameters.forEach { (key, value) -> put(key, value) } })
            }
        }
        val text = request(directory, PATH_INSTALL, payload)
        LOG.info("marketplace install dir=$directory id=${item.id} type=${item.type} target=$target")
        return result(text)
    }

    suspend fun remove(directory: String, id: String, type: String, scope: String): MarketplaceResultDto {
        val payload = buildJsonObject {
            put("item", buildJsonObject { put("id", id); put("type", type) })
            put("scope", scope)
        }
        val text = request(directory, PATH_REMOVE, payload)
        LOG.info("marketplace remove dir=$directory id=$id type=$type scope=$scope")
        return result(text)
    }

    /**
     * The wire shape here is a 1:1 match for [MarketplaceResultDto], so this decodes rather than
     * hand-parsing like [toDecoded] has to. [WireResult] is declared in this module rather than
     * decoded directly into the shared DTO: `shared` compiles against the platform's
     * kotlinx-serialization while this module bundles its own, so asking a *shared* DTO for its
     * serializer from here resolves `KSerializer` from two different classloaders and fails with a
     * `LinkageError`. A module-local type's serializer is generated and consumed in the same
     * classloader, so it decodes cleanly and is then mapped onto the shared DTO by hand.
     */
    private fun result(text: String): MarketplaceResultDto {
        val wire = JSON.decodeFromString<WireResult>(text)
        return MarketplaceResultDto(wire.success, wire.slug, wire.error, wire.filePath, wire.line)
    }

    @Serializable
    private data class WireResult(
        val success: Boolean = false,
        val slug: String = "",
        val error: String? = null,
        val filePath: String? = null,
        val line: Int? = null,
    )

    private fun installedKeys(element: JsonElement?): Set<String> = element?.jsonObject?.keys ?: emptySet()

    /** [item] paired with its raw `suggest_for.filename` glob patterns, used only to compute [relevantKeys]. */
    private data class Decoded(val item: MarketplaceItemDto, val key: String, val filenames: List<String>)

    private fun JsonObject.toDecoded(project: Set<String>, global: Set<String>): Decoded? {
        val type = str("type") ?: return null
        if (type !in KNOWN_TYPES) return null
        val id = str("id") ?: return null
        val name = str("name") ?: return null
        val description = str("description") ?: return null
        val category = str("category") ?: return null
        val contentElement = get("content") ?: JsonPrimitive("")
        val key = "$type:$id"

        val parameters = mcpParameters("parameters")
        val methods = if (type == "mcp") mcpMethods(contentElement) else emptyList()
        val filenames = (get("suggest_for") as? JsonObject)?.stringList("filename") ?: emptyList()

        val item = MarketplaceItemDto(
            id = id,
            type = type,
            name = name,
            description = description,
            category = category,
            author = str("author"),
            authorUrl = str("authorUrl"),
            url = str("url"),
            githubUrl = str("githubUrl"),
            prerequisites = stringList("prerequisites"),
            parameters = if (type == "mcp") parameters else emptyList(),
            methods = methods,
            content = contentElement.toString(),
            installedProject = project.contains(key),
            installedGlobal = global.contains(key),
        )
        return Decoded(item, key, filenames)
    }

    /**
     * Walks [directory] once, bounded by [MAX_RELEVANCE_FILES], to find which `suggest_for.filename`
     * glob patterns have a match anywhere in the tree (excluding [EXCLUDED_DIRS]). Mirrors the VS Code
     * marketplace's relevance heuristic (`workspace.findFiles("**\/<pattern>", EXCLUDE, 1)`).
     */
    private fun relevantKeys(directory: String, decoded: List<Decoded>): Set<String> {
        if (directory.isBlank()) return emptySet()
        val root = runCatching { Path.of(directory) }.getOrNull() ?: return emptySet()
        if (!Files.isDirectory(root)) return emptySet()
        val patterns = decoded.flatMapTo(mutableSetOf()) { it.filenames }
        if (patterns.isEmpty()) return emptySet()
        val fs = FileSystems.getDefault()
        val matchers = patterns.associateWith { fs.getPathMatcher("glob:**/$it") }
        val found = mutableSetOf<String>()
        var visited = 0
        Files.walkFileTree(
            root,
            object : SimpleFileVisitor<Path>() {
                override fun preVisitDirectory(dir: Path, attrs: BasicFileAttributes): FileVisitResult {
                    val name = dir.fileName?.toString()
                    return if (name != null && name in EXCLUDED_DIRS) FileVisitResult.SKIP_SUBTREE else FileVisitResult.CONTINUE
                }

                override fun visitFile(file: Path, attrs: BasicFileAttributes): FileVisitResult {
                    if (++visited > MAX_RELEVANCE_FILES || found.size == matchers.size) return FileVisitResult.TERMINATE
                    val rel = root.relativize(file)
                    for ((pattern, matcher) in matchers) {
                        if (pattern in found) continue
                        if (matcher.matches(rel)) found += pattern
                    }
                    return FileVisitResult.CONTINUE
                }
            },
        )
        return decoded.filter { it.filenames.any { pattern -> pattern in found } }.mapTo(mutableSetOf()) { it.key }
    }

    private fun mcpMethods(content: JsonElement): List<MarketplaceMethodDto> {
        val array = (content as? JsonArray) ?: return emptyList()
        return array.mapNotNull { element ->
            val obj = element as? JsonObject ?: return@mapNotNull null
            val name = obj.str("name") ?: return@mapNotNull null
            MarketplaceMethodDto(
                name = name,
                prerequisites = obj.stringList("prerequisites"),
                parameters = obj.mcpParameters("parameters"),
            )
        }
    }

    private fun JsonObject.mcpParameters(key: String): List<MarketplaceParamDto> {
        val array = this[key] as? JsonArray ?: return emptyList()
        return array.mapNotNull { element ->
            val obj = element as? JsonObject ?: return@mapNotNull null
            val name = obj.str("name") ?: return@mapNotNull null
            val paramKey = obj.str("key") ?: return@mapNotNull null
            MarketplaceParamDto(
                name = name,
                key = paramKey,
                placeholder = obj.str("placeholder"),
                optional = (obj["optional"] as? JsonPrimitive)?.booleanOrNull ?: false,
            )
        }
    }

    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

    private fun JsonObject.stringList(key: String): List<String> =
        (this[key] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull } ?: emptyList()

    private suspend fun request(directory: String, path: String, body: JsonObject?): String = withContext(Dispatchers.IO) {
        val http = app.http ?: throw IllegalStateException("Kilo HTTP client is unavailable")
        val url = "http://127.0.0.1:${app.port}$path?directory=${encode(directory)}"
        val request = Request.Builder().url(url).let { builder ->
            if (body == null) builder.get() else builder.post(body.toString().toRequestBody(JSON_MEDIA))
        }.build()
        http.newCall(request).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                LOG.warn("marketplace request failed: $path HTTP ${response.code}")
                throw RuntimeException("HTTP ${response.code}")
            }
            text.ifBlank { "{}" }
        }
    }

    private fun encode(value: String): String = URLEncoder.encode(value, StandardCharsets.UTF_8)

    private companion object {
        val LOG = KiloLog.create(KiloBackendMarketplaceManager::class.java)
        val JSON = Json { ignoreUnknownKeys = true }
        val JSON_MEDIA = "application/json".toMediaType()
        val KNOWN_TYPES = setOf("mcp", "agent", "skill")
        val EXCLUDED_DIRS = setOf("node_modules", ".git", "dist", "build", "out", ".kilo", ".opencode", ".kilocode")
        const val MAX_RELEVANCE_FILES = 20_000
        const val PATH_LIST = "/kilocode/marketplace"
        const val PATH_INSTALL = "/kilocode/marketplace/install"
        const val PATH_REMOVE = "/kilocode/marketplace/remove"
    }
}
