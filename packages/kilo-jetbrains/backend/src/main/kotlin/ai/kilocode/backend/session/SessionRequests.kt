package ai.kilocode.backend.session

import ai.kilocode.backend.v2.V2Client
import ai.kilocode.rpc.dto.PermissionAlwaysRulesDto
import ai.kilocode.rpc.dto.PermissionFileDiffDto
import ai.kilocode.rpc.dto.PermissionReplyDto
import ai.kilocode.rpc.dto.PermissionRequestDto
import ai.kilocode.rpc.dto.PermissionRuleDecisionDto
import ai.kilocode.rpc.dto.QuestionInfoDto
import ai.kilocode.rpc.dto.QuestionOptionDto
import ai.kilocode.rpc.dto.QuestionReplyDto
import ai.kilocode.rpc.dto.QuestionRequestDto
import ai.kilocode.rpc.dto.ToolRefDto
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

internal fun permissionDto(p: JsonObject): PermissionRequestDto {
    val meta = p.obj("metadata")
    val action = p.required("action")
    val flags = meta?.flatten().orEmpty().toMutableMap()
    if (action == "sandbox_escalation") flags["sandboxEscalation"] = "true"
    if (action == "browser_sensitive") flags["browserSensitive"] = "true"
    val save = p.strings("save")
    val rules = (save + meta?.strings("rules").orEmpty()).distinct()
    val path = meta?.str("filePath") ?: meta?.str("path")
    val files = (meta?.items("diffs").orEmpty() + meta?.items("files").orEmpty() + listOfNotNull(meta?.obj("filediff"))).mapNotNull {
        val f = it as? JsonObject ?: return@mapNotNull null
        PermissionFileDiffDto(f.str("file") ?: f.str("relativePath") ?: f.str("filePath") ?: path ?: return@mapNotNull null,
            f.str("patch"), f.str("before"), f.str("after"), f.str("additions")?.toIntOrNull() ?: 0, f.str("deletions")?.toIntOrNull() ?: 0)
    }.ifEmpty { meta?.str("diff")?.let { listOf(PermissionFileDiffDto(path ?: "patch", patch = it)) }.orEmpty() }
    return PermissionRequestDto(p.required("id"), p.required("sessionID"), action, p.strings("resources"), flags, save,
        p.obj("source")?.let(::toolRef), p.str("message") ?: meta?.str("message"), meta?.str("command"), rules,
        rules.map { PermissionRuleDecisionDto(it) }, path, files, meta?.strings("commands").orEmpty())
}

private fun toolRef(source: JsonObject) = source.str("messageID")?.let { message -> source.str("id")?.let { ToolRefDto(message, it) } }

private fun displayed(form: JsonObject) = form.items("fields").map { it.jsonObject }.filter { it.str("hidden") != "true" }
internal fun formDto(form: JsonObject): QuestionRequestDto {
    val meta = form.obj("metadata")
    val questions = displayed(form).map { f ->
        val type = f.required("type")
        val hints = meta?.obj("kilocode")?.obj("options")?.obj(f.required("key"))
        val opts = f.items("options").map { value ->
            val o = value.jsonObject
            val hint = hints?.obj(o.required("value"))
            QuestionOptionDto(o.required("label"), o.str("description").orEmpty(), hint?.str("labelKey"), hint?.str("descriptionKey"), hint?.str("mode"))
        }
        val question = f.str("description") ?: f.str("title") ?: form.required("title")
        QuestionInfoDto(if (type == "external") "$question\n${f.required("url")}" else question, f.str("title") ?: form.required("title"),
            when (type) {
                "boolean" -> listOf(QuestionOptionDto("true", ""), QuestionOptionDto("false", ""))
                "external" -> listOf(QuestionOptionDto("true", f.required("url")))
                else -> opts
            }, multiple = type == "multiselect", custom = type !in setOf("boolean", "external") && (opts.isEmpty() || f.str("custom") == "true"))
    }
    return QuestionRequestDto(form.required("id"), form.required("sessionID"), questions,
        meta?.obj("tool")?.let(::toolRef), blocking = true)
}

/** The split UI returns displayed labels by position; the server expects typed values keyed by field. */
internal fun formAnswer(form: JsonObject, reply: QuestionReplyDto): JsonObject {
    val visible = displayed(form)
    require(reply.answers.size <= visible.size) { "Unexpected form answers" }
    val byKey = visible.zip(reply.answers).associate { (f, a) -> f.required("key") to a }
    val answer = mutableMapOf<String, JsonElement>()
    return JsonObject(answer.apply {
        for (entry in form.items("fields")) {
            val f = entry.jsonObject
            val key = f.required("key")
            if (!f.items("when").all { row ->
                    val cond = row.jsonObject
                    val prior = this[cond.required("key")] ?: return@all false
                    val matches = if (prior is JsonArray) cond["value"] in prior else cond["value"] == prior
                    matches == (cond.str("op") == "eq")
                }) continue
            val values = byKey[key].orEmpty().filter { it.isNotEmpty() }.map { label ->
                f.items("options").firstOrNull { it.jsonObject.str("label") == label }?.jsonObject?.required("value") ?: label
            }
            val value = when {
                values.isEmpty() -> f["default"]
                f.str("type") == "multiselect" -> JsonArray(values.map(::JsonPrimitive))
                f.str("type") == "boolean" -> JsonPrimitive(values.single().toBooleanStrict())
                f.str("type") == "external" -> { require(values.single() == "true"); JsonPrimitive(true) }
                f.str("type") == "integer" -> JsonPrimitive(values.single().toLong())
                f.str("type") == "number" -> JsonPrimitive(values.single().toDouble().also { require(it.isFinite()) })
                else -> JsonPrimitive(values.single())
            }
            if (value != null) put(key, value)
        }
    })
}

internal class SessionRequests(private val client: suspend () -> V2Client) {
    suspend fun permissions(dir: String) = client().call("permission.request.list", query = scopeQuery(dir)).data().jsonArray.map { permissionDto(it.jsonObject) }
    private suspend fun forms(dir: String) = client().call("form.list", query = scopeQuery(dir)).data().jsonArray.map { it.jsonObject }
    suspend fun questions(dir: String) = forms(dir).map(::formDto)

    suspend fun replyPermission(id: String, dir: String, reply: PermissionReplyDto) {
        val req = permissions(dir).single { it.id == id }
        if (reply.reply != "reject" && listOf("skillShell", "sandboxEscalation", "browserSensitive").any { req.metadata[it] == "true" }) {
            require(reply.interactive) { "This permission requires a human decision" }
        }
        client().call("session.permission.reply", sessionPath(req.sessionID) + ("requestID" to id),
            body = fields("decision" to reply.reply, "message" to reply.message))
    }

    suspend fun saveRules(id: String, dir: String, rules: PermissionAlwaysRulesDto) {
        val request = permissions(dir).single { it.id == id }
        val decided = rules.approvedAlways.associateWith { "allow" } + rules.deniedAlways.associateWith { "deny" }
        if (decided.isEmpty()) return
        require(decided.keys.all { it in request.rules }) { "Rule not offered by this permission request" }
        val api = client()
        val settings = api.sessionRpc("kilocode.settings", "read", dir, fields("scope" to "global")).jsonObject
        val target = settings.getValue("target").jsonObject
        val existing = settings.getValue("document").jsonObject.items("permissions")
        val updated = buildJsonArray {
            existing.filterNot { val r = it.jsonObject; r.str("action") == request.permission && r.str("resource") in decided.keys }.forEach { add(it) }
            decided.forEach { (resource, effect) -> add(fields("action" to request.permission, "resource" to resource, "effect" to effect)) }
        }
        api.sessionRpc("kilocode.settings", "write", dir, buildJsonObject {
            put("scope", "global"); put("set", buildJsonObject { put("permissions", updated) })
            target.str("revision")?.let { put("expected", fields("path" to target.required("path"), "revision" to it)) }
        })
    }

    suspend fun replyQuestion(id: String, dir: String, answers: QuestionReplyDto) {
        val form = forms(dir).single { it.str("id") == id }
        client().call("session.form.reply", sessionPath(form.required("sessionID")) + ("formID" to id),
            body = buildJsonObject { put("answer", formAnswer(form, answers)) })
    }

    suspend fun rejectQuestion(id: String, dir: String) {
        val form = forms(dir).single { it.str("id") == id }
        client().call("session.form.cancel", sessionPath(form.required("sessionID")) + ("formID" to id))
    }
}
