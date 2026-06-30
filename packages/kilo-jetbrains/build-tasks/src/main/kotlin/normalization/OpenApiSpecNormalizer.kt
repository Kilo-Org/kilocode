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
        // Step 1: Remove duplicate dot-notation schemas and remap their $refs to
        //         camelCase equivalents so the spec remains self-consistent.
        // Step 2: Strip operation-level tags so all routes land in DefaultApi.
        // Step 3: Deduplicate the root-level tags array.
        // Step 4: Fix nullable fields in the /kilo/profile response that Effect's
        //         OpenAPI generator incorrectly emits as non-nullable.
        val (noDotsRoot, _) = remapDotSchemas(root)
        val stripped = stripTags(noDotsRoot)
        val deduped = dedupRootTags(stripped)
        val fixed = fixProfileNullable(deduped)
        return encode(fixed)
    }

    private fun encode(obj: JsonObject): String {
        val json = Json { prettyPrint = true }
            .encodeToString(JsonElement.serializer(), obj)
        return "$json\n"
    }

    /**
     * Find schemas whose names contain dots (e.g. "Event.tui.command.execute").
     * If a camelCase equivalent (e.g. "EventTuiCommandExecute") exists in the
     * same component map, remove the dot schema and rewrite every `$ref` that
     * points to it to use the camelCase name instead.
     */
    private fun remapDotSchemas(root: JsonObject): Pair<JsonObject, Map<String, String>> {
        val components = root["components"] as? JsonObject ?: return root to emptyMap()
        val schemas = components["schemas"] as? JsonObject ?: return root to emptyMap()

        // Build a map of dot-name → camelCase-name for schemas that have a
        // camelCase duplicate in the same spec.
        val dotMap = schemas.keys
            .filter { "." in it }
            .mapNotNull { dot ->
                val camel = dot.split(".").joinToString("") { w -> w.replaceFirstChar { c -> c.uppercase() } }
                if (camel in schemas) dot to camel else null
            }
            .toMap()

        if (dotMap.isEmpty()) return root to emptyMap()

        // Remove dot schemas.
        val cleaned = JsonObject(schemas.filterKeys { it !in dotMap })
        val noDotsComponents = JsonObject(components + mapOf("schemas" to cleaned))
        val noDotsRoot = JsonObject(root + mapOf("components" to noDotsComponents))

        // Rewrite $ref strings throughout the whole spec.
        val rewritten = rewriteRefs(noDotsRoot, dotMap)
        return rewritten to dotMap
    }

    /**
     * Recursively rewrite every JsonPrimitive `$ref` value that matches a
     * dot-notation schema name, replacing it with the camelCase equivalent.
     */
    private fun rewriteRefs(element: JsonElement, map: Map<String, String>): JsonObject {
        return rewriteElement(element, map) as JsonObject
    }

    private fun rewriteElement(element: JsonElement, map: Map<String, String>): JsonElement =
        when (element) {
            is JsonObject -> JsonObject(element.mapValues { (key, value) ->
                if (key == "\$ref" && value is JsonPrimitive) {
                    val ref = value.content
                    val prefix = "#/components/schemas/"
                    if (ref.startsWith(prefix)) {
                        val name = ref.removePrefix(prefix)
                        val replaced = map[name]
                        if (replaced != null) JsonPrimitive("$prefix$replaced") else value
                    } else value
                } else rewriteElement(value, map)
            })
            is JsonArray -> JsonArray(element.map { rewriteElement(it, map) })
            else -> element
        }

    /**
     * Remove the "tags" field from every operation so that openapi-generator
     * collects all operations into a single DefaultApi class.
     */
    private fun stripTags(root: JsonObject): JsonObject {
        val paths = root["paths"] as? JsonObject ?: return root
        val stripped = JsonObject(paths.mapValues { (_, item) ->
            val path = item as? JsonObject ?: return@mapValues item
            JsonObject(path.mapValues { (_, op) ->
                val obj = op as? JsonObject ?: return@mapValues op
                if ("tags" !in obj) return@mapValues op
                JsonObject(obj.filterKeys { it != "tags" })
            })
        })
        return JsonObject(root + mapOf("paths" to stripped))
    }

    /**
     * Fix the `/kilo/profile` GET 200 response schema: Effect's OpenAPI generator
     * emits `balance`, `kiloPass`, and `currentOrgId` as non-nullable required fields even
     * though the server schema is `Schema.NullOr(...)`.  Wrap each non-nullable
     * property in `anyOf: [<original-schema>, {"type": "null"}]` so the generated
     * Kotlin model uses a nullable type.  Already-nullable properties (those that
     * already have `anyOf` containing `{"type":"null"}`) are left untouched.
     */
    private fun fixProfileNullable(root: JsonObject): JsonObject {
        val paths = root["paths"] as? JsonObject ?: return root
        val profileItem = paths["/kilo/profile"] as? JsonObject ?: return root
        val getOp = profileItem["get"] as? JsonObject ?: return root
        val schema = getOp["responses"]
            ?.let { it as? JsonObject }?.get("200")
            ?.let { it as? JsonObject }?.get("content")
            ?.let { it as? JsonObject }?.get("application/json")
            ?.let { it as? JsonObject }?.get("schema")
            as? JsonObject ?: return root
        val props = schema["properties"] as? JsonObject ?: return root

        val nullable = setOf("balance", "kiloPass", "currentOrgId")
        val fixed = JsonObject(props.mapValues { (key, value) ->
            if (key !in nullable) return@mapValues value
            val obj = value as? JsonObject ?: return@mapValues value
            // Skip if already wrapped (has anyOf containing {type:null}).
            val existing = obj["anyOf"] as? JsonArray
            if (existing != null && existing.any {
                    (it as? JsonObject)?.get("type")?.let { t -> (t as? JsonPrimitive)?.content } == "null"
                }) return@mapValues value
            JsonObject(mapOf("anyOf" to JsonArray(listOf(obj, JsonObject(mapOf("type" to JsonPrimitive("null")))))))
        })

        // Rebuild nested objects up to root.
        val responses = getOp["responses"]!! as JsonObject
        val resp200 = responses["200"]!! as JsonObject
        val content = resp200["content"]!! as JsonObject
        val appJson = content["application/json"]!! as JsonObject
        val newSchema = JsonObject(schema + mapOf("properties" to fixed))
        val newApp = JsonObject(appJson + mapOf("schema" to newSchema))
        val newContent = JsonObject(content + mapOf("application/json" to newApp))
        val new200 = JsonObject(resp200 + mapOf("content" to newContent))
        val newResponses = JsonObject(responses + mapOf("200" to new200))
        val newGet = JsonObject(getOp + mapOf("responses" to newResponses))
        val newProfile = JsonObject(profileItem + mapOf("get" to newGet))
        val newPaths = JsonObject(paths + mapOf("/kilo/profile" to newProfile))
        return JsonObject(root + mapOf("paths" to newPaths))
    }

    /**
     * Deduplicate the root-level "tags" array by name — the spec validator
     * rejects repeated tag names even when they describe different things.
     */
    private fun dedupRootTags(root: JsonObject): JsonObject {
        val tags = root["tags"] as? JsonArray ?: return root
        val seen = mutableSetOf<String>()
        val deduped = tags.filter { tag ->
            val name = (tag as? JsonObject)?.let { (it["name"] as? JsonPrimitive)?.content }
                ?: return@filter true
            seen.add(name)
        }
        return JsonObject(root + mapOf("tags" to JsonArray(deduped)))
    }
}
