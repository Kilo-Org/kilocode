package ai.kilocode.backend.migration

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Shared JSON helpers for parsing legacy source data and building migration payloads.
 */
object LegacyMigrationJson {

    val json = Json { ignoreUnknownKeys = true }

    fun parseObject(raw: String): JsonObject? =
        runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull()

    fun parseArray(raw: String): JsonArray? =
        runCatching { json.parseToJsonElement(raw).jsonArray }.getOrNull()

    /** Build a JsonObject from key→value pairs, skipping null values. */
    fun obj(vararg pairs: Pair<String, JsonElement?>): JsonObject =
        JsonObject(pairs.mapNotNull { (k, v) -> v?.let { k to it } }.toMap())

    fun str(value: String?): JsonPrimitive? = value?.let { JsonPrimitive(it) }
    fun bool(value: Boolean): JsonPrimitive = JsonPrimitive(value)
    fun num(value: Long): JsonPrimitive = JsonPrimitive(value)
    fun num(value: Double): JsonPrimitive = JsonPrimitive(value)

    fun arr(elements: List<JsonElement>): JsonArray = JsonArray(elements)

    fun JsonObject.str(key: String): String? =
        this[key]?.jsonPrimitive?.contentOrNull

    fun JsonObject.bool(key: String): Boolean? =
        this[key]?.let { if (it is JsonNull) null else it.jsonPrimitive.booleanOrNull }

    fun JsonObject.long(key: String): Long? =
        this[key]?.jsonPrimitive?.contentOrNull?.toLongOrNull()

    fun JsonObject.obj(key: String): JsonObject? =
        runCatching { this[key]?.jsonObject }.getOrNull()

    fun JsonObject.arr(key: String): JsonArray? =
        runCatching { this[key]?.jsonArray }.getOrNull()

    /** Extract a string value from a dynamic JsonElement (any provider settings map) */
    fun JsonElement?.asString(): String? =
        this?.let { runCatching { it.jsonPrimitive.contentOrNull }.getOrNull() }

    /** Deep-merge two JSON objects: values in [patch] override [base]. */
    fun merge(base: JsonObject, patch: JsonObject): JsonObject {
        val result = base.toMutableMap()
        for ((k, v) in patch) {
            val existing = result[k]
            result[k] = if (existing is JsonObject && v is JsonObject) merge(existing, v) else v
        }
        return JsonObject(result)
    }
}
