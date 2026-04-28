package ai.kilocode.client.session.model

enum class QuestionRequestState { PENDING, RESPONDING, ERROR }

data class Question(
    val id: String,
    val items: List<QuestionItem>,
    val tool: ToolCallRef? = null,
    val state: QuestionRequestState = QuestionRequestState.PENDING,
)

data class QuestionItem(
    val question: String,
    val header: String,
    val options: List<QuestionOption>,
    val multiple: Boolean,
    val custom: Boolean,
)

data class QuestionOption(
    val label: String,
    val description: String,
)
