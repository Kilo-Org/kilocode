package ai.kilocode.client.session.model

enum class QuestionRequestState { PENDING, RESPONDING, ERROR }

data class Question(
    val id: String,
    val items: List<QuestionItem>,
    val tool: ToolCallRef? = null,
    val state: QuestionRequestState = QuestionRequestState.PENDING,
    val blocking: Boolean = false,
)

data class QuestionItem(
    val question: String,
    val header: String,
    val options: List<QuestionOption>,
    val multiple: Boolean,
    val custom: Boolean,
    val questionKey: String? = null,
    val headerKey: String? = null,
)

data class QuestionOption(
    val label: String,
    val description: String,
    val labelKey: String? = null,
    val descriptionKey: String? = null,
    val mode: String? = null,
)
