package ai.kilocode.backend.session

import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageErrorDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.PartSourceDto
import ai.kilocode.rpc.dto.PartSourceTextDto
import ai.kilocode.rpc.dto.PartTimeDto
import ai.kilocode.rpc.dto.PromptDto
import ai.kilocode.rpc.dto.TodoDto
import ai.kilocode.rpc.dto.TokensDto
import ai.kilocode.rpc.dto.ToolApprovalDto
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.util.Base64

internal class SessionTranscript(private val sid: String, var parent: String? = null) {
    private var agent: String? = null
    private var model: JsonObject? = null

    fun message(m: JsonObject): MessageWithPartsDto? {
        val id = m.required("id")
        val type = m.required("type")
        val time = m.getValue("time").jsonObject
        val role = when (type) {
            "agent-switched" -> { agent = m.str("agent"); return null }
            "model-switched" -> { model = m.obj("model"); return null }
            "user" -> { parent = id; "user" }
            "assistant", "compaction", "shell" -> "assistant"
            else -> return null // Synthetic and control records are not conversation bubbles.
        }
        val selected = m.obj("model") ?: model
        val info = MessageDto(id, sid, role, MessageTimeDto(time.required("created").toDouble(), time.str("completed")?.toDouble()),
            agent = m.str("agent") ?: agent, providerID = selected?.str("providerID"), modelID = selected?.str("id"),
            parentID = parent.takeIf { role == "assistant" }, cost = m.str("cost")?.toDouble(), tokens = m.obj("tokens")?.let(::usage),
            finish = m.str("finish"), error = m.obj("error")?.let(::chatError))
        val parts = when (type) {
            "user" -> buildList {
                add(PartDto(partID(id, "text", 0), sid, id, "text", text = m.required("text")))
                m.items("files").filterNot { it.jsonObject.str("name") == CONTEXT_FILE && m.obj("metadata")?.str("jetbrainsEditorContext") == "true" }
                    .forEachIndexed { index, f -> add(filePart(sid, id, index, f.jsonObject)) }
            }
            "compaction" -> listOf(PartDto(partID(id, "compaction", 0), sid, id, "compaction", text = m.str("summary")))
            "shell" -> listOf(PartDto(partID(id, "shell", 0), sid, id, "tool", tool = "bash", state = m.str("status"),
                input = mapOf("command" to m.required("command")), output = m.obj("output")?.str("output")))
            else -> {
                val counts = mutableMapOf<String, Int>()
                m.items("content").mapNotNull { content ->
                    val c = content.jsonObject
                    when (val kind = c.str("type")) {
                        "tool" -> toolPart(sid, id, c)
                        "reasoning", "text" -> {
                            val ordinal = counts.getOrDefault(kind, 0); counts[kind] = ordinal + 1
                            PartDto(partID(id, kind, ordinal), sid, id, kind, text = c.str("text"), time = c.obj("time")?.let(::partTime))
                        }
                        else -> null
                    }
                }
            }
        }
        val finish = info.finish
        return MessageWithPartsDto(info, if (type == "assistant" && finish != null) parts + PartDto(
            partID(id, "step-finish", 0), sid, id, "step-finish", reason = finish, tokens = info.tokens, cost = info.cost,
        ) else parts)
    }
}

internal fun partID(message: String, kind: String, ordinal: Int) = "$message:$kind:$ordinal"
private fun partTime(o: JsonObject) = PartTimeDto((o.str("ran") ?: o.str("created"))?.toDouble(), o.str("completed")?.toDouble())
internal fun chatError(o: JsonObject) = MessageErrorDto(o.required("type"), o.str("message"), o.str("status")?.toInt(), o.obj("response")?.str("body"))
internal fun usage(o: JsonObject) = TokensDto(o.required("input").toLong(), o.required("output").toLong(), o.required("reasoning").toLong(),
    o.getValue("cache").jsonObject.required("read").toLong(), o.getValue("cache").jsonObject.required("write").toLong())

private fun filePart(sid: String, message: String, ordinal: Int, o: JsonObject): PartDto {
    val mime = o.required("mime")
    val source = o.obj("source")
    return PartDto(partID(message, "file", ordinal), sid, message, "file", mime = mime, filename = o.str("name"),
        url = o.str("data")?.let { "data:$mime;base64,$it" } ?: o.str("uri"), source = o.obj("mention")?.let { mention ->
            PartSourceDto("file", PartSourceTextDto(mention.required("text"), mention.required("start").toDouble(), mention.required("end").toDouble()),
                path = source?.str("uri") ?: o.str("name"))
        })
}

internal fun toolPart(sid: String, message: String, c: JsonObject): PartDto {
    val state = c.getValue("state").jsonObject
    val input = state.obj("input")
    val meta = state.obj("metadata")
    val metadata = meta?.flatten().orEmpty().toMutableMap()
    meta?.str("sessionID")?.let { metadata["sessionId"] = it }
    val name = c.required("name")
    val todos = (meta?.get("todos") ?: input?.get("todos")) as? JsonArray
    val approval = meta?.obj("approval")
    return PartDto(partIDForTool(message, c.required("id")), sid, message, "tool", tool = name, callID = c.required("id"),
        state = when (val s = state.str("status")) { "streaming" -> "pending"; else -> s }, title = meta?.str("title"),
        input = input?.flatten().orEmpty(), metadata = metadata, output = state.items("content").mapNotNull { it.jsonObject.str("text") ?: it.jsonObject.str("uri") }.joinToString("\n"),
        time = c.obj("time")?.let(::partTime), error = state.obj("error")?.str("message"),
        approval = approval?.str("source")?.let { ToolApprovalDto(it, approval.str("agent"), approval.obj("rule")?.str("action"),
            approval.obj("rule")?.str("resource"), approval.obj("rule")?.str("effect")) },
        todos = todos.orEmpty().map { row -> val t = row.jsonObject
            TodoDto(t.str("content").orEmpty(), t.str("status") ?: "pending", t.str("priority") ?: "medium", t.str("changed") == "true") })
}

internal fun partIDForTool(message: String, call: String) = "$message:tool:$call"
private const val CONTEXT_FILE = "jetbrains-editor-context.txt"

internal fun promptBody(prompt: PromptDto, command: String? = null, arguments: String? = null): JsonObject = buildJsonObject {
    put("text", arguments ?: prompt.parts.filter { it.type == "text" }.mapNotNull { it.text }.joinToString("\n"))
    if (command != null) put("name", command) else {
        prompt.messageID?.let { put("id", it) }
        if (prompt.noReply == true) put("resume", false)
        if (prompt.editorContext != null) put("metadata", buildJsonObject { put("jetbrainsEditorContext", true) })
    }
    val files = buildJsonArray {
        for (part in prompt.parts.filter { it.type == "file" }) add(buildJsonObject {
            put("uri", requireNotNull(part.url) { "Missing file URI" }); part.filename?.let { put("name", it) }
            val source = part.source
            if (source != null) {
                put("mention", buildJsonObject { put("start", source.text.start); put("end", source.text.end); put("text", source.text.value) })
                val uri = source.uri ?: source.path?.let { path -> if (path.startsWith("file:")) path else runCatching {
                    java.nio.file.Path.of(path).takeIf { it.isAbsolute }?.toUri()?.toString()
                }.getOrNull() }
                if (uri != null) put("source", fields("type" to "uri", "uri" to uri))
            }
        })
        prompt.editorContext?.let { c ->
            val context = buildJsonObject {
                c.directory?.let { put("directory", it) }; c.worktree?.let { put("worktree", it) }; c.shell?.let { put("shell", it) }
                c.activeFile?.let { put("activeFile", it) }; c.visibleFiles?.let { put("visibleFiles", JsonArray(it.map(::JsonPrimitive))) }
                c.openTabs?.let { put("openTabs", JsonArray(it.map(::JsonPrimitive))) }
            }
            if (context.isNotEmpty()) add(fields("name" to CONTEXT_FILE, "description" to "Editor context", "uri" to
                "data:text/plain;base64,${Base64.getEncoder().encodeToString(context.toString().toByteArray(Charsets.UTF_8))}"))
        }
    }
    if (files.isNotEmpty()) put("files", files)
}
