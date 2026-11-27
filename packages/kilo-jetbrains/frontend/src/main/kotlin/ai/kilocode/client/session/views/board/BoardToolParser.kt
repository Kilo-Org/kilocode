package ai.kilocode.client.session.views.board

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** One row of the shared agent board, from either `board_post` or `board_read` output. */
internal data class BoardMessageView(
    val from: String,
    val to: String,
    val fromLabel: String?,
    val toLabel: String?,
    val type: String,
    val body: String,
)

/** Normalized `board_post` / `board_read` tool result, ready for markdown rendering. */
internal data class BoardResult(
    val read: Boolean,
    val messages: List<BoardMessageView>,
    val warning: String?,
)

/**
 * Parses the JSON `output` of `board_post`/`board_read` tool calls into a [BoardResult].
 * Returns null for anything unparseable so [BoardToolView.canRender] falls back to the generic
 * [ai.kilocode.client.session.views.tool.ToolView], never showing a broken card.
 */
internal object BoardToolParser {
    private val json = Json { ignoreUnknownKeys = true }

    fun parse(tool: Tool): BoardResult? {
        if (tool.state != ToolExecState.COMPLETED) return null
        val output = tool.output?.takeIf { it.isNotBlank() } ?: return null
        val obj = runCatching { json.parseToJsonElement(output).jsonObject }.getOrNull() ?: return null
        return when (tool.name) {
            "board_post" -> parsePost(tool, obj)
            "board_read" -> parseRead(obj)
            else -> null
        }
    }

    private fun parsePost(tool: Tool, obj: JsonObject): BoardResult? {
        val message = messageView(obj, tool.metadata) ?: return null
        return BoardResult(read = false, messages = listOf(message), warning = obj.str("warning"))
    }

    private fun parseRead(obj: JsonObject): BoardResult? {
        val arr = runCatching { obj["messages"]?.jsonArray }.getOrNull() ?: return null
        val messages = arr.map { elem ->
            val row = runCatching { elem.jsonObject }.getOrNull() ?: return null
            messageView(row, emptyMap()) ?: return null
        }
        return BoardResult(read = true, messages = messages, warning = null)
    }

    /** [metadata] wins over [obj] for the route fields, matching the CLI's authoritative metadata. */
    private fun messageView(obj: JsonObject, metadata: Map<String, String>): BoardMessageView? {
        val from = metadata["from"] ?: obj.str("from") ?: return null
        val to = metadata["to"] ?: obj.str("to") ?: return null
        val type = metadata["type"] ?: obj.str("type") ?: return null
        val body = obj.str("body") ?: return null
        return BoardMessageView(
            from = from,
            to = to,
            fromLabel = metadata["fromLabel"] ?: obj.str("fromLabel"),
            toLabel = metadata["toLabel"] ?: obj.str("toLabel"),
            type = type,
            body = body,
        )
    }

    private fun JsonObject.str(key: String): String? = this[key]?.jsonPrimitive?.contentOrNull
}

/** Renders a [BoardResult] as markdown for the transcript card body and hover popup. */
internal fun boardMarkdown(result: BoardResult): String =
    result.messages.joinToString("\n\n---\n\n") { message ->
        buildString {
            append("**").append(escapeMd(message.type)).append("** &middot; ")
            append(escapeMd(message.fromLabel ?: message.from))
            append(" &rarr; ")
            append(escapeMd(message.toLabel ?: message.to))
            append("\n\n")
            append(message.body)
        }
    } + (result.warning?.takeIf { it.isNotBlank() }?.let { "\n\n_${escapeMd(it)}_" } ?: "")

private fun escapeMd(text: String): String = text
    .replace("\\", "\\\\")
    .replace("*", "\\*")
    .replace("_", "\\_")
    .replace("`", "\\`")
    .replace("[", "\\[")
    .replace("]", "\\]")
