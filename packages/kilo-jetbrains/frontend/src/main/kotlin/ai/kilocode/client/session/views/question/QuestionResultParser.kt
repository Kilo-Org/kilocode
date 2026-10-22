package ai.kilocode.client.session.views.question

import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

internal data class QuestionResult(
    val questions: List<String>,
    val answers: List<List<String>>,
)

internal object QuestionResultParser {

    private val json = Json { ignoreUnknownKeys = true }

    fun parse(tool: Tool): QuestionResult? {
        if (tool.name != "question" || tool.state != ToolExecState.COMPLETED) return null
        val questions = parseQuestions(tool.input["questions"] ?: return null) ?: return null
        return QuestionResult(questions, parseAnswers(tool.metadata["answers"]))
    }

    private fun parseQuestions(raw: String): List<String>? {
        val arr = runCatching { json.parseToJsonElement(raw).jsonArray }.getOrNull() ?: return null
        val list = arr.mapNotNull { elem ->
            elem.jsonObject["question"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }
        }
        return list.takeIf { it.isNotEmpty() }
    }

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
