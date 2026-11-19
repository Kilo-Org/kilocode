package ai.kilocode.backend.workspace

import ai.kilocode.backend.settings.McpSettingsCodec
import ai.kilocode.rpc.dto.AgentConfigDto
import ai.kilocode.rpc.dto.AgentConfigPatchDto
import ai.kilocode.rpc.dto.CompactionConfigDto
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.PermissionConfigDto
import ai.kilocode.rpc.dto.PermissionRuleDto
import ai.kilocode.rpc.dto.RetentionConfigDto
import ai.kilocode.rpc.dto.SkillsConfigDto
import ai.kilocode.rpc.dto.WatcherConfigDto
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.math.BigDecimal

internal fun workspaceConfig(doc: JsonObject): ConfigDto {
    val agents = doc.obj("agents").orEmpty().mapValues { (_, row) -> agentConfig(row.jsonObject) }
    return ConfigDto(
        model = selection(doc["model"]), smallModel = agents["title"]?.model,
        defaultAgent = doc.text("default_agent"), subagentModel = doc.text("subagent_model"), subagentVariant = doc.text("subagent_variant"),
        watcher = doc.obj("watcher")?.let { WatcherConfigDto(it.strings("ignore")) },
        compaction = doc.obj("compaction")?.let {
            val buffer = it.text("buffer")
            val threshold = when {
                buffer == "0" -> 100.0
                buffer?.endsWith('%') == true -> buffer.dropLast(1).toDoubleOrNull()?.let { unused -> 100 - unused }
                else -> null
            }
            CompactionConfigDto(it.flag("auto"), threshold)
        },
        instructions = doc.strings("instructions"),
        skills = (doc["skills"] as? JsonArray)?.let {
            val (urls, paths) = doc.strings("skills").partition { path -> path.startsWith("https://") || path.startsWith("http://") }
            SkillsConfigDto(paths, urls)
        },
        mcp = doc.obj("mcp")?.obj("servers").orEmpty().mapValues { McpSettingsCodec.read(it.value.jsonObject) },
        agent = agents, permission = permissions(doc["permissions"]), shared_agent_board = doc.flag("shared_agent_board"),
        snapshot = doc.flag("snapshots"), retention = doc.obj("retention")?.let { RetentionConfigDto(it.flag("enabled"), it.long("maxAgeDays")?.toInt()) },
    )
}

private fun agentConfig(row: JsonObject): AgentConfigDto {
    val body = row.obj("request")?.obj("body")
    return AgentConfigDto(model = selection(row["model"]), variant = variant(row["model"]), prompt = row.text("system"),
        description = row.text("description"), mode = row.text("mode"), hidden = row.flag("hidden"), disable = row.flag("disabled"),
        temperature = body?.number("temperature"), top_p = body?.number("top_p"), steps = row.long("steps"), permission = permissions(row["permissions"]))
}

private fun permissions(value: JsonElement?): PermissionConfigDto? = (value as? JsonArray)?.map { it.jsonObject }
    ?.groupBy { it.required("action") }?.mapValues { (_, rules) ->
        val resources = rules.associate { it.required("resource") to it.required("effect") }
        if (resources.keys == setOf("*")) PermissionRuleDto.Level(resources.getValue("*")) else PermissionRuleDto.Patterns(resources)
    }

/** Keep untouched rules in their original positions: a wildcard rule can match several actions. */
private fun patchPermissions(current: JsonElement?, changes: PermissionConfigDto): JsonArray {
    var rules = (current as? JsonArray).orEmpty().map { it.jsonObject }
    for ((key, rule) in changes) {
        val action = when (key) { "bash" -> "shell"; "task" -> "subagent"; "write", "patch", "apply_patch" -> "edit"; else -> key }
        val next = when (rule) {
            is PermissionRuleDto.Level -> mapOf("*" to rule.value)
            is PermissionRuleDto.Patterns -> rule.map
        }.filterValues { it != null }.toMutableMap()
        val last = rules.indexOfLast { it.text("action") == action }
        rules = buildList {
            fun addNew() = next.forEach { (resource, effect) -> add(buildJsonObject {
                put("action", action); put("resource", resource); put("effect", effect)
            }) }
            rules.forEachIndexed { index, row ->
                if (row.text("action") != action) add(row)
                else next.remove(row.required("resource"))?.let { add(JsonObject(row + ("effect" to JsonPrimitive(it)))) }
                if (index == last) addNew()
            }
            if (last == -1) addNew()
        }
    }
    return JsonArray(rules)
}

internal fun workspacePatch(patch: ConfigPatchDto, doc: JsonObject): JsonObject = buildJsonObject {
    for ((key, value) in patch.values) {
        if (key == "small_model") continue
        require(key in setOf("model", "default_agent", "subagent_model", "subagent_variant")) { "Unknown setting: $key" }
        put(key, JsonPrimitive(value))
    }
    patch.watcher?.ignore?.let { put("watcher", buildJsonObject { put("ignore", strings(it)) }) }
    patch.compaction?.let { change ->
        require(change.prune == null) { "Compaction pruning is not a configurable v2 setting" }
        put("compaction", buildJsonObject {
            if ("threshold_percent" in change.clear) put("buffer", JsonNull)
            if ("auto" in change.clear) put("auto", JsonNull)
            change.auto?.let { put("auto", it) }
            change.threshold_percent?.let {
                require(it > 0 && it <= 100) { "Compaction threshold must be above 0 and at most 100" }
                val unused = 100 - it
                if (unused == 0.0) put("buffer", 0)
                else put("buffer", "${BigDecimal.valueOf(unused.coerceIn(1.0, 99.999)).stripTrailingZeros().toPlainString()}%")
            }
        })
    }
    patch.instructions?.let { put("instructions", strings(it)) }
    patch.skills?.let { change ->
        val old = workspaceConfig(doc).skills
        put("skills", strings((change.paths ?: old?.paths.orEmpty()) + (change.urls ?: old?.urls.orEmpty())))
    }
    patch.mcp?.let { servers -> put("mcp", buildJsonObject {
        put("servers", buildJsonObject { servers.forEach { (id, value) -> put(id, value?.let(McpSettingsCodec::write) ?: JsonNull) } })
    }) }
    if (patch.agents.isNotEmpty() || "small_model" in patch.values) put("agents", buildJsonObject {
        val names = patch.agents.keys + if ("small_model" in patch.values) setOf("title") else emptySet()
        for (name in names) {
            val change = patch.agents[name] ?: AgentConfigPatchDto()
            val row = agentPatch(change, doc.obj("agents")?.obj(name) ?: JsonObject(emptyMap()))
            put(name, if (name == "title" && "small_model" in patch.values && "model" !in row)
                JsonObject(row + ("model" to JsonPrimitive(patch.values["small_model"]))) else row)
        }
    })
    patch.permission?.let { put("permissions", patchPermissions(doc["permissions"], it)) }
    patch.snapshot?.let { put("snapshots", it) }
    patch.shared_agent_board?.let { put("shared_agent_board", it) }
    patch.retention?.let { r -> put("retention", buildJsonObject {
        r.enabled?.let { put("enabled", it) }; r.maxAgeDays?.let { put("maxAgeDays", it) }
    }) }
}

private fun agentPatch(change: AgentConfigPatchDto, current: JsonObject): JsonObject = buildJsonObject {
    val names = mapOf("prompt" to "system", "disable" to "disabled", "permission" to "permissions")
    for (key in change.clear) {
        if (key in setOf("temperature", "top_p", "variant")) continue
        put(names[key] ?: key, JsonNull)
    }
    if ("model" !in change.clear && (change.model != null || change.variant != null || "variant" in change.clear)) {
        val model = change.model ?: selection(current["model"])
        val variant = change.variant ?: if ("variant" in change.clear || change.model != null) null else variant(current["model"])
        require(model != null || variant == null) { "Setting an agent variant requires a model" }
        put("model", JsonPrimitive(model?.let { if (variant.isNullOrEmpty()) it else "${it.substringBefore('#')}#$variant" }))
    }
    change.prompt?.let { put("system", it) }; change.description?.let { put("description", it) }; change.mode?.let { put("mode", it) }
    change.hidden?.let { put("hidden", it) }; change.disable?.let { put("disabled", it) }; change.steps?.let { put("steps", it) }
    if (change.temperature != null || change.top_p != null || change.clear.any { it == "temperature" || it == "top_p" }) {
        put("request", buildJsonObject { put("body", buildJsonObject {
            if ("temperature" in change.clear) put("temperature", JsonNull)
            if ("top_p" in change.clear) put("top_p", JsonNull)
            change.temperature?.let { put("temperature", it) }; change.top_p?.let { put("top_p", it) }
        }) })
    }
    change.permission?.let { put("permissions", patchPermissions(current["permissions"], it)) }
}

private fun strings(rows: List<String>) = JsonArray(rows.map(::JsonPrimitive))
