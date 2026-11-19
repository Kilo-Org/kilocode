package ai.kilocode.backend.marketplace

import ai.kilocode.backend.settings.*
import ai.kilocode.backend.v2.V2Client
import ai.kilocode.backend.v2.V2HttpException
import ai.kilocode.rpc.dto.*
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.*

class KiloBackendMarketplaceManager(private val client: suspend () -> V2Client = ::settingsClient) {
    private suspend fun rpc(method: String, directory: String, input: JsonObject = emptyObject) =
        client().plugin("kilocode.marketplace", method, directory, input)

    private suspend fun installed(directory: String) =
        rpc("installed", directory).jsonArray.map { it.jsonObject }

    suspend fun list(directory: String): MarketplaceListDto = coroutineScope {
        val installed = async { installed(directory) }
        val catalogs =
            listOf("skill", "agent", "mcp")
                .map { kind ->
                    async { rpc("list", directory, mapOf("kind" to kind).asJson()).jsonObject }
                }
                .awaitAll()
        val records = installed.await()
        MarketplaceListDto(
            catalogs
                .flatMap { it.rows("items") }
                .map { item ->
                    val refs =
                        records.filter { row ->
                            listOf("registry", "kind", "id").all { row[it] == item[it] }
                        }
                    MarketplaceItemDto(
                        id = item.required("id"),
                        type = item.required("kind"),
                        name = item.required("name"),
                        description = item.required("description"),
                        category = item.text("category").orEmpty(),
                        author = item.text("author"),
                        url = item.text("url"),
                        prerequisites = item.strings("prerequisites"),
                        parameters = params(item),
                        methods =
                            item.rows("options").map {
                                MarketplaceMethodDto(
                                    it.required("name"),
                                    it.strings("prerequisites"),
                                    params(item) + params(it),
                                )
                            },
                        content = item.toString(),
                        installedProject = refs.any { it.text("scope") == "project" },
                        installedGlobal = refs.any { it.text("scope") == "global" },
                    )
                },
            catalogs
                .flatMap { it.rows("failures") }
                .map { "${it.required("registry")}: ${it.required("message")}" }
                .distinct(),
        )
    }

    suspend fun install(
        directory: String,
        item: MarketplaceItemDto,
        target: String,
        parameters: Map<String, String>,
    ): MarketplaceResultDto {
        val raw = Json.parseToJsonElement(item.content).jsonObject
        return mutation(item.id) {
            val result = rpc(
                    "install",
                    directory,
                    buildJsonObject {
                        put("registry", raw.required("registry"))
                        put("kind", item.type)
                        put("id", item.id)
                        put("scope", target)
                        parameters["__method"]?.let { put("option", it) }
                        put("params", (parameters - "__method").asJson())
                    },
                )
                .jsonObject
            MarketplaceResultDto(true, result.required("id"))
        }
    }

    suspend fun remove(
        directory: String,
        id: String,
        type: String,
        scope: String,
    ): MarketplaceResultDto {
        val row =
            installed(directory).singleOrNull {
                it.text("id") == id && it.text("kind") == type && it.text("scope") == scope
            }
                ?: return MarketplaceResultDto(
                    false,
                    id,
                    "Could not identify a unique installed item",
                )
        return mutation(id) {
            rpc(
            "uninstall",
            directory,
            mapOf(
                    "registry" to row.required("registry"),
                    "id" to id,
                    "kind" to type,
                    "scope" to scope,
                )
                .asJson(),
        )
            MarketplaceResultDto(true, id)
        }
    }

    private suspend fun mutation(id: String, block: suspend () -> MarketplaceResultDto): MarketplaceResultDto =
        try { block() } catch (e: V2HttpException) {
            val detail = runCatching { Json.parseToJsonElement(e.body).jsonObject.text("message") }.getOrNull()
            MarketplaceResultDto(false, id, detail ?: e.message)
        }

    suspend fun bundles(directory: String): List<MarketplaceBundleDto> {
        val skills = client().data("skill.list", directory).jsonArray.map { it.jsonObject }
        return installed(directory)
            .filter { it.text("kind") == "mcp" }
            .mapNotNull { record ->
                val ids = record.rows("resources").mapNotNull { it.text("id") }.toSet()
                val paths = skills.filter { it.text("id") in ids }.map { it.required("path") }
                if (paths.isEmpty()) null
                else MarketplaceBundleDto(record.required("id"), record.required("scope"), paths)
            }
    }

    private fun params(obj: JsonObject) =
        obj.rows("parameters").map {
            MarketplaceParamDto(
                it.required("name"),
                it.required("key"),
                it.text("placeholder"),
                it["optional"]?.jsonPrimitive?.booleanOrNull == true,
            )
        }
}
