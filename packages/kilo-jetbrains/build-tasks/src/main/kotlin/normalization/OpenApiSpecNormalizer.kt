package normalization

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.gradle.api.GradleException

internal object OpenApiSpecNormalizer {
    fun normalize(raw: String): String {
        val root = Json.parseToJsonElement(raw) as? JsonObject
            ?: throw GradleException("OpenAPI spec root must be a JSON object.")
        val tags = root["tags"] as? JsonArray ?: return raw
        val (fixedTags, renames) = fixTags(tags)
        if (renames.isEmpty()) return raw
        val paths = root["paths"] as? JsonObject
            ?: throw GradleException("OpenAPI spec paths must be a JSON object.")
        val fixed = JsonObject(
            root + mapOf(
                "tags" to fixedTags,
                "paths" to fixPaths(paths, renames),
            )
        )
        val json = Json { prettyPrint = true }
            .encodeToString(JsonElement.serializer(), fixed)
        return "$json\n"
    }

    private fun fixTags(tags: JsonArray): Pair<JsonArray, Map<String, Rename>> {
        val rules = rules()
        val counts = mutableMapOf<String, Int>()
        val renames = mutableMapOf<String, Rename>()
        val fixed = tags.map { tag ->
            val item = tag as? JsonObject ?: return@map tag
            val name = text(item["name"]) ?: return@map tag
            val rule = rules[name] ?: return@map tag
            val index = counts.getOrDefault(name, 0)
            counts[name] = index + 1
            if (index >= rule.dedups.size) {
                throw GradleException("Missing final OpenAPI tag name for duplicate '$name' at index $index.")
            }
            val dedup = rule.dedups[index]
            if (index == 0) return@map tag
            renames[dedup.name] = Rename(rule.original, dedup)
            JsonObject(item + ("name" to JsonPrimitive(dedup.name)))
        }
        rules.forEach { (name, rule) ->
            val count = counts[name] ?: 0
            if (count > 1 && count != rule.dedups.size) {
                throw GradleException("Duplicate OpenAPI tag '$name' has $count entries but ${rule.dedups.size} final names.")
            }
        }
        return JsonArray(fixed) to renames
    }

    private fun fixPaths(paths: JsonObject, renames: Map<String, Rename>): JsonObject {
        val ops = renames.values.flatMap { rename ->
            rename.dedup.ops.map { id -> id to rename }
        }.toMap()
        val hits = mutableMapOf<String, Int>()
        val fixed = JsonObject(paths.mapValues { (_, item) ->
            val path = item as? JsonObject ?: return@mapValues item
            JsonObject(path.mapValues { (_, op) ->
                val obj = op as? JsonObject ?: return@mapValues op
                val id = text(obj["operationId"]) ?: return@mapValues op
                val rename = ops[id] ?: return@mapValues op
                hits[id] = hits.getOrDefault(id, 0) + 1
                fixOp(obj, rename)
            })
        })
        ops.keys.forEach { id ->
            val count = hits[id] ?: 0
            if (count != 1) {
                throw GradleException("Expected one OpenAPI operation '$id' for tag normalization, found $count.")
            }
        }
        return fixed
    }

    private fun fixOp(op: JsonObject, rename: Rename): JsonObject {
        val tags = op["tags"] as? JsonArray
            ?: throw GradleException("OpenAPI operation must declare tags before tag normalization.")
        val count = tags.count { tag -> text(tag) == rename.from }
        if (count != 1) {
            throw GradleException("Expected one '${rename.from}' operation tag, found $count.")
        }
        return JsonObject(op + ("tags" to JsonArray(tags.map { tag ->
            if (text(tag) != rename.from) return@map tag
            JsonPrimitive(rename.dedup.name)
        })))
    }

    private fun rules(): Map<String, DuplicateTagRule> {
        if (duplicateTagRules.map { it.original }.toSet().size != duplicateTagRules.size) {
            throw GradleException("OpenAPI duplicate tag config must not repeat original tag names.")
        }
        return duplicateTagRules.associateBy { rule ->
            if (rule.dedups.size < 2 || rule.dedups.first().name != rule.original) {
                throw GradleException("OpenAPI tag rule '${rule.original}' must keep the original tag first.")
            }
            if (rule.dedups.map { it.name }.toSet().size != rule.dedups.size) {
                throw GradleException("OpenAPI tag rule '${rule.original}' must use unique dedup names.")
            }
            rule.original
        }
    }

    private fun text(value: JsonElement?) = (value as? JsonPrimitive)?.content

    private data class Rename(
        val from: String,
        val dedup: TagDedup,
    )
}
