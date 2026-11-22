package ai.kilocode.client.session.views.question

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

internal data class QuestionResult(
    val questions: List<String>,
    val answers: List<List<String>>,
)

/** One answered question of a completed `question` tool, as the prompt navigator lists it. */
internal data class QuestionAnswer(
    /** Index of the question in the tool input, so entries stay stable when earlier ones are skipped. */
    val index: Int,
    val question: String,
    val header: String,
    val answers: List<String>,
)

internal object QuestionResultParser {

    private val json = Json { ignoreUnknownKeys = true }

    fun parse(tool: Tool): QuestionResult? {
        if (tool.name != "question" || tool.state != ToolExecState.COMPLETED) return null
        val questions = parseQuestions(tool.input["questions"] ?: return null) ?: return null
        return QuestionResult(questions, parseAnswers(tool.metadata["answers"]))
    }

    /**
     * Questions of a completed `question` tool that the user actually answered, one entry per question
     * item and aligned with the answers by index. Unanswered items are skipped: the navigator only lists
     * questions the user can go back to.
     */
    fun answered(tool: Tool): List<QuestionAnswer> {
        if (tool.name != "question" || tool.state != ToolExecState.COMPLETED) return emptyList()
        val items = parseItems(tool.input["questions"] ?: return emptyList()) ?: return emptyList()
        val answers = parseAnswers(tool.metadata["answers"])
        return items.mapIndexedNotNull { i, item ->
            val values = answers.getOrNull(i).orEmpty().filter { it.isNotBlank() }
            if (values.isEmpty()) return@mapIndexedNotNull null
            QuestionAnswer(
                index = i,
                question = item.first,
                header = item.second.ifBlank { item.first },
                answers = values,
            )
        }
    }

    private fun parseQuestions(raw: String): List<String>? {
        val items = parseItems(raw) ?: return null
        val list = items.map { it.first }.filter { it.isNotBlank() }
        return list.takeIf { it.isNotEmpty() }
    }

    /** `(question, header)` for each item of the tool's `questions` input, in their original order. */
    private fun parseItems(raw: String): List<Pair<String, String>>? {
        val arr = runCatching { json.parseToJsonElement(raw).jsonArray }.getOrNull() ?: return null
        return arr.map { elem ->
            val obj = runCatching { elem.jsonObject }.getOrNull()
            text(obj, "question") to text(obj, "header")
        }
    }

    /**
     * A string field of [obj], or empty for a missing or non-string value. Reading [jsonPrimitive] on an
     * object/array throws, and a malformed tool payload must not take down the whole navigator rebuild.
     */
    private fun text(obj: JsonObject?, key: String): String =
        runCatching { obj?.get(key)?.jsonPrimitive?.contentOrNull }.getOrNull().orEmpty()

    private fun parseAnswers(raw: String?): List<List<String>> {
        val arr = raw
            ?.takeIf { it.isNotBlank() }
            ?.let { runCatching { json.parseToJsonElement(it).jsonArray }.getOrNull() }
        return arr?.map { elem ->
            runCatching {
                elem.jsonArray.mapNotNull { it.jsonPrimitive.contentOrNull?.takeIf(String::isNotBlank) }
            }.getOrDefault(emptyList())
        } ?: emptyList()
    }
}
