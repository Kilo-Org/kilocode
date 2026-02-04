package ai.kilo.plugin.mock

import ai.kilo.plugin.model.*
import ai.kilo.plugin.services.KiloProjectService
import ai.kilo.plugin.store.ChatUiStateManager
import ai.kilo.plugin.store.MessageChange
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.awt.BorderLayout
import java.awt.FlowLayout
import javax.swing.*

/**
 * Floating dialog for injecting mock data into the chat UI.
 * Opens via gear menu when mock mode is enabled in settings.
 *
 * Sends mock events through the same channels as real server events,
 * so the UI processes them identically.
 */
class MockControlDialog(private val project: Project) : DialogWrapper(project, false) {

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val typeCombo = ComboBox(MockType.entries.toTypedArray())

    private var currentSessionId = "ses_mock"
    private var messageCounter = 0
    private var partCounter = 0

    init {
        title = "Mock Control"
        setOKButtonText("Close")
        setCancelButtonText("Render")
        init()
    }

    override fun createCenterPanel(): JComponent {
        val panel = JPanel(BorderLayout(JBUI.scale(8), JBUI.scale(8)))
        panel.border = JBUI.Borders.empty(8)

        val row = JPanel(FlowLayout(FlowLayout.LEFT, JBUI.scale(8), 0))
        row.add(JBLabel("Type:"))
        row.add(typeCombo)

        panel.add(row, BorderLayout.CENTER)
        panel.add(JBLabel("Select a type and click 'Render' to inject mock data"), BorderLayout.SOUTH)

        return panel
    }

    override fun doCancelAction() {
        // "Render" button triggers this
        render()
    }

    override fun doOKAction() {
        // "Close" button - just close
        super.doOKAction()
    }

    private fun getStore(): ChatUiStateManager? {
        return KiloProjectService.getInstance(project).sessionStore
    }

    private fun nextMessageId() = "msg_mock_${++messageCounter}"
    private fun nextPartId() = "prt_mock_${++partCounter}"

    private fun render() {
        val store = getStore() ?: return
        val type = typeCombo.selectedItem as MockType

        scope.launch {
            ensureSession(store)

            when (type) {
                MockType.TEXT -> emitAssistantMessage(store, createTextPart())
                MockType.REASONING -> emitAssistantMessage(store, createReasoningPart())
                MockType.FILE -> emitAssistantMessage(store, createFilePart())
                MockType.AGENT -> emitAssistantMessage(store, createAgentPart())
                MockType.SUBTASK -> emitAssistantMessage(store, createSubtaskPart())
                MockType.SNAPSHOT -> emitAssistantMessage(store, createSnapshotPart())
                MockType.PATCH -> emitAssistantMessage(store, createPatchPart())
                MockType.COMPACTION -> emitAssistantMessage(store, createCompactionPart())
                MockType.RETRY -> emitAssistantMessage(store, createRetryPart())

                MockType.TOOL_GLOB -> emitAssistantMessage(store, createToolPart("glob"))
                MockType.TOOL_READ -> emitAssistantMessage(store, createToolPart("read"))
                MockType.TOOL_WRITE -> emitAssistantMessage(store, createToolPart("write"))
                MockType.TOOL_EDIT -> emitAssistantMessage(store, createToolPart("edit"))
                MockType.TOOL_BASH -> emitAssistantMessage(store, createToolPart("bash"))
                MockType.TOOL_GREP -> emitAssistantMessage(store, createToolPart("grep"))
                MockType.TOOL_WEBSEARCH -> emitAssistantMessage(store, createToolPart("websearch"))
                MockType.TOOL_WEBFETCH -> emitAssistantMessage(store, createToolPart("webfetch"))
                MockType.TOOL_TASK -> emitAssistantMessage(store, createToolPart("task"))
                MockType.TOOL_TODOREAD -> emitAssistantMessage(store, createToolPart("todoread"))
                MockType.TOOL_TODOWRITE -> emitAssistantMessage(store, createToolPart("todowrite"))
                MockType.TOOL_APPLYPATCH -> emitAssistantMessage(store, createToolPart("applypatch"))
                MockType.TOOL_QUESTION -> emitAssistantMessage(store, createToolPart("question"))

                MockType.TOOL_PENDING -> emitAssistantMessage(store, createToolPart("bash", "pending"))
                MockType.TOOL_RUNNING -> emitAssistantMessage(store, createToolPart("bash", "running"))
                MockType.TOOL_ERROR -> emitAssistantMessage(store, createToolPart("bash", "error"))

                MockType.ERROR_RATE_LIMIT -> emitErrorMessage(store, "APIError", "Rate limit exceeded", 429)
                MockType.ERROR_AUTH -> emitErrorMessage(store, "ProviderAuthError", "Invalid API key", null)
                MockType.ERROR_ABORTED -> emitErrorMessage(store, "MessageAbortedError", "Aborted by user", null)

                MockType.PERMISSION_REQUEST -> emitPermissionRequest(store)
                MockType.QUESTION_REQUEST -> emitQuestionRequest(store)

                MockType.STREAMING_TEXT -> runStreamingDemo(store)
                MockType.TOOL_EXECUTION_FLOW -> runToolExecutionDemo(store)
                MockType.ALL_TOOLS -> showAllTools(store)
                MockType.ALL_PARTS -> showAllParts(store)
            }
        }
    }

    private suspend fun ensureSession(store: ChatUiStateManager) {
        val mockSession = Session(
            id = currentSessionId,
            slug = "mock-session",
            projectID = "mock-project",
            directory = "/mock/path",
            title = "Mock Session",
            version = "1.0.0",
            time = SessionTime(created = System.currentTimeMillis(), updated = System.currentTimeMillis())
        )

        try {
            val clazz = store::class.java
            val sessionsFlowField = clazz.getDeclaredField("_sessions").apply { isAccessible = true }
            val currentSessionIdFlowField = clazz.getDeclaredField("_currentSessionId").apply { isAccessible = true }

            @Suppress("UNCHECKED_CAST")
            val sessionsFlow = sessionsFlowField.get(store) as kotlinx.coroutines.flow.MutableStateFlow<List<Session>>
            @Suppress("UNCHECKED_CAST")
            val currentSessionIdFlow = currentSessionIdFlowField.get(store) as kotlinx.coroutines.flow.MutableStateFlow<String?>

            if (sessionsFlow.value.none { it.id == currentSessionId }) {
                sessionsFlow.value = sessionsFlow.value + mockSession
            }
            currentSessionIdFlow.value = currentSessionId
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun createTextPart(): Part = Part(
        id = nextPartId(), sessionID = currentSessionId, messageID = "", type = "text",
        text = "This is sample **markdown** text with `code`.\n\n```kotlin\nfun hello() = \"Hello!\"\n```"
    )

    private fun createReasoningPart(): Part = Part(
        id = nextPartId(), sessionID = currentSessionId, messageID = "", type = "reasoning",
        text = "**Analyzing**\n\nLet me think step by step...\n\n[REDACTED]"
    )

    private fun createFilePart(): Part = Part(
        id = nextPartId(), sessionID = currentSessionId, messageID = "", type = "file",
        url = "file:///mock/document.pdf", filename = "document.pdf", mime = "application/pdf"
    )

    private fun createAgentPart(): Part = Part(
        id = nextPartId(), sessionID = currentSessionId, messageID = "", type = "agent",
        callID = "agent_${System.currentTimeMillis()}", name = "code-analyzer"
    )

    private fun createSubtaskPart(): Part = Part(
        id = nextPartId(), sessionID = currentSessionId, messageID = "", type = "subtask",
        callID = "subtask_${System.currentTimeMillis()}", prompt = "Find API endpoints",
        description = "Exploring API", agent = "Explore"
    )

    private fun createSnapshotPart(): Part = Part(
        id = nextPartId(), sessionID = currentSessionId, messageID = "", type = "snapshot",
        callID = "snapshot_${System.currentTimeMillis()}", snapshot = "abc123"
    )

    private fun createPatchPart(): Part = Part(
        id = nextPartId(), sessionID = currentSessionId, messageID = "", type = "patch",
        callID = "patch_${System.currentTimeMillis()}", hash = "patch-abc",
        files = listOf("src/Example.kt", "src/Test.kt")
    )

    private fun createCompactionPart(): Part = Part(
        id = nextPartId(), sessionID = currentSessionId, messageID = "", type = "compaction",
        callID = "compaction_${System.currentTimeMillis()}", auto = true
    )

    private fun createRetryPart(): Part = Part(
        id = nextPartId(), sessionID = currentSessionId, messageID = "", type = "retry",
        callID = "retry_${System.currentTimeMillis()}", attempt = 2,
        error = JsonObject(mapOf("name" to JsonPrimitive("APIError"), "message" to JsonPrimitive("Rate limit")))
    )

    private fun createToolPart(tool: String, status: String = "completed"): Part {
        val input = when (tool) {
            "glob" -> mapOf("pattern" to JsonPrimitive("src/**/*.kt"))
            "read" -> mapOf("filePath" to JsonPrimitive("src/Example.kt"))
            "write" -> mapOf("filePath" to JsonPrimitive("src/New.kt"))
            "edit" -> mapOf("filePath" to JsonPrimitive("src/Example.kt"))
            "bash" -> mapOf("command" to JsonPrimitive("npm test"))
            "grep" -> mapOf("pattern" to JsonPrimitive("TODO"))
            "websearch" -> mapOf("query" to JsonPrimitive("Kotlin best practices"))
            "webfetch" -> mapOf("url" to JsonPrimitive("https://example.com"))
            "task" -> mapOf("description" to JsonPrimitive("Analyze API"))
            "todoread" -> emptyMap()
            "todowrite" -> mapOf("todos" to JsonPrimitive("[...]"))
            "applypatch" -> mapOf("patchFile" to JsonPrimitive("/changes.patch"))
            "question" -> mapOf("questions" to JsonPrimitive("[...]"))
            else -> emptyMap()
        }

        val output = when (tool) {
            "glob" -> "src/Example.kt\nsrc/Utils.kt"
            "read" -> "package com.example\n\nclass Example {}"
            "bash" -> "PASS\nTests: 5 passed"
            else -> "Completed"
        }

        val stateObj = JsonObject(buildMap {
            put("status", JsonPrimitive(status))
            put("input", JsonObject(input))
            if (status == "completed") put("output", JsonPrimitive(output))
            if (status == "error") put("error", JsonPrimitive("Error: File not found"))
            put("title", JsonPrimitive(""))
            put("metadata", JsonObject(emptyMap()))
            put("time", JsonObject(mapOf(
                "start" to JsonPrimitive(System.currentTimeMillis() - 1000),
                "end" to JsonPrimitive(System.currentTimeMillis())
            )))
        })

        return Part(
            id = nextPartId(), sessionID = currentSessionId, messageID = "", type = "tool",
            tool = tool, callID = "tool_${tool}_${System.currentTimeMillis()}", state = stateObj
        )
    }

    private suspend fun emitAssistantMessage(store: ChatUiStateManager, mainPart: Part) {
        val messageId = nextMessageId()
        val partWithMessageId = mainPart.copy(messageID = messageId)

        val parts = listOf(
            Part(id = nextPartId(), sessionID = currentSessionId, messageID = messageId, type = "step-start", snapshot = "s"),
            partWithMessageId,
            Part(id = nextPartId(), sessionID = currentSessionId, messageID = messageId, type = "step-finish", reason = "stop", snapshot = "s")
        )

        val message = MessageWithParts(
            info = Message(
                id = messageId, sessionID = currentSessionId, role = "assistant",
                time = MessageTime(created = System.currentTimeMillis(), completed = System.currentTimeMillis()),
                modelID = "claude-sonnet-4", providerID = "anthropic", mode = "code", agent = "code", finish = "stop"
            ),
            parts = parts
        )
        emitEvent(store, MessageChange.MessageAdded(currentSessionId, message))
    }

    private suspend fun emitErrorMessage(store: ChatUiStateManager, errorName: String, errorMsg: String, statusCode: Int?) {
        val messageId = nextMessageId()
        val message = MessageWithParts(
            info = Message(
                id = messageId, sessionID = currentSessionId, role = "assistant",
                time = MessageTime(created = System.currentTimeMillis()),
                modelID = "claude-sonnet-4", providerID = "anthropic",
                error = MessageError(name = errorName, message = errorMsg, statusCode = statusCode, isRetryable = statusCode == 429)
            ),
            parts = emptyList()
        )
        emitEvent(store, MessageChange.MessageAdded(currentSessionId, message))
    }

    private suspend fun emitPermissionRequest(store: ChatUiStateManager) {
        try {
            val field = store::class.java.getDeclaredField("_pendingPermissions").apply { isAccessible = true }
            @Suppress("UNCHECKED_CAST")
            val flow = field.get(store) as kotlinx.coroutines.flow.MutableStateFlow<List<PermissionRequest>>
            flow.value = listOf(PermissionRequest(
                id = "perm_${System.currentTimeMillis()}", sessionID = currentSessionId,
                permission = "bash:execute", patterns = listOf("rm -rf *"),
                metadata = JsonObject(mapOf("command" to JsonPrimitive("rm -rf logs/*.log"))),
                always = listOf("file:read")
            ))
        } catch (e: Exception) { e.printStackTrace() }
    }

    private suspend fun emitQuestionRequest(store: ChatUiStateManager) {
        try {
            val field = store::class.java.getDeclaredField("_pendingQuestions").apply { isAccessible = true }
            @Suppress("UNCHECKED_CAST")
            val flow = field.get(store) as kotlinx.coroutines.flow.MutableStateFlow<List<QuestionRequest>>
            flow.value = listOf(QuestionRequest(
                id = "quest_${System.currentTimeMillis()}", sessionID = currentSessionId,
                questions = listOf(QuestionInfo(
                    question = "Which framework?", header = "Testing",
                    options = listOf(
                        QuestionOption(label = "Jest", description = "Popular"),
                        QuestionOption(label = "Vitest", description = "Fast")
                    )
                ))
            ))
        } catch (e: Exception) { e.printStackTrace() }
    }

    private suspend fun runStreamingDemo(store: ChatUiStateManager) {
        val messageId = nextMessageId()
        val partId = nextPartId()
        val fullText = "This is streaming. Each word appears one at a time."

        val msgInfo = Message(
            id = messageId, sessionID = currentSessionId, role = "assistant",
            time = MessageTime(created = System.currentTimeMillis()),
            modelID = "claude-sonnet-4", providerID = "anthropic", mode = "code", agent = "code"
        )

        var text = ""
        for ((i, word) in fullText.split(" ").withIndex()) {
            text += (if (i > 0) " " else "") + word
            val part = Part(id = partId, sessionID = currentSessionId, messageID = messageId, type = "text", text = text)
            val msg = MessageWithParts(info = msgInfo, parts = listOf(part))

            if (i == 0) emitEvent(store, MessageChange.MessageAdded(currentSessionId, msg))
            else emitEvent(store, MessageChange.PartUpdated(currentSessionId, messageId, part, " $word"))

            kotlinx.coroutines.delay(80)
        }
    }

    private suspend fun runToolExecutionDemo(store: ChatUiStateManager) {
        val messageId = nextMessageId()
        val partId = nextPartId()
        val msgInfo = Message(
            id = messageId, sessionID = currentSessionId, role = "assistant",
            time = MessageTime(created = System.currentTimeMillis()),
            modelID = "claude-sonnet-4", providerID = "anthropic", mode = "code", agent = "code"
        )

        for (status in listOf("pending", "running", "completed")) {
            val part = createToolPart("bash", status).copy(id = partId, messageID = messageId)
            val msg = MessageWithParts(info = msgInfo, parts = listOf(part))

            if (status == "pending") emitEvent(store, MessageChange.MessageAdded(currentSessionId, msg))
            else emitEvent(store, MessageChange.PartUpdated(currentSessionId, messageId, part, null))

            kotlinx.coroutines.delay(if (status == "running") 2000 else 1000)
        }
    }

    private suspend fun showAllTools(store: ChatUiStateManager) {
        val messageId = nextMessageId()
        val tools = listOf("glob", "read", "write", "edit", "bash", "grep", "websearch", "webfetch", "task", "todoread", "todowrite", "applypatch", "question")
        val parts = mutableListOf(
            Part(id = nextPartId(), sessionID = currentSessionId, messageID = messageId, type = "step-start", snapshot = "s"),
            Part(id = nextPartId(), sessionID = currentSessionId, messageID = messageId, type = "text", text = "All ${tools.size} tools:")
        )
        tools.forEach { parts.add(createToolPart(it).copy(messageID = messageId)) }
        parts.add(Part(id = nextPartId(), sessionID = currentSessionId, messageID = messageId, type = "step-finish", reason = "stop", snapshot = "s"))

        val msg = MessageWithParts(
            info = Message(id = messageId, sessionID = currentSessionId, role = "assistant",
                time = MessageTime(created = System.currentTimeMillis(), completed = System.currentTimeMillis()),
                modelID = "claude-sonnet-4", providerID = "anthropic", mode = "code", agent = "code", finish = "stop"),
            parts = parts
        )
        emitEvent(store, MessageChange.MessageAdded(currentSessionId, msg))
    }

    private suspend fun showAllParts(store: ChatUiStateManager) {
        val messageId = nextMessageId()
        val parts = mutableListOf(
            createTextPart(), createReasoningPart(), createFilePart(), createAgentPart(),
            createSubtaskPart(), createSnapshotPart(), createPatchPart(), createCompactionPart(),
            createRetryPart(), createToolPart("read")
        ).map { it.copy(messageID = messageId) }

        val msg = MessageWithParts(
            info = Message(id = messageId, sessionID = currentSessionId, role = "assistant",
                time = MessageTime(created = System.currentTimeMillis(), completed = System.currentTimeMillis()),
                modelID = "claude-sonnet-4", providerID = "anthropic", mode = "code", agent = "code", finish = "stop"),
            parts = parts
        )
        emitEvent(store, MessageChange.MessageAdded(currentSessionId, msg))
    }

    private suspend fun emitEvent(store: ChatUiStateManager, change: MessageChange) {
        try {
            val field = store::class.java.getDeclaredField("_messageChanges").apply { isAccessible = true }
            @Suppress("UNCHECKED_CAST")
            val flow = field.get(store) as MutableSharedFlow<MessageChange>
            flow.emit(change)
        } catch (e: Exception) { e.printStackTrace() }
    }

    enum class MockType(private val displayName: String) {
        TEXT("Part: Text"),
        REASONING("Part: Reasoning"),
        FILE("Part: File"),
        AGENT("Part: Agent"),
        SUBTASK("Part: Subtask"),
        SNAPSHOT("Part: Snapshot"),
        PATCH("Part: Patch"),
        COMPACTION("Part: Compaction"),
        RETRY("Part: Retry"),

        TOOL_GLOB("Tool: Glob"),
        TOOL_READ("Tool: Read"),
        TOOL_WRITE("Tool: Write"),
        TOOL_EDIT("Tool: Edit"),
        TOOL_BASH("Tool: Bash"),
        TOOL_GREP("Tool: Grep"),
        TOOL_WEBSEARCH("Tool: WebSearch"),
        TOOL_WEBFETCH("Tool: WebFetch"),
        TOOL_TASK("Tool: Task"),
        TOOL_TODOREAD("Tool: TodoRead"),
        TOOL_TODOWRITE("Tool: TodoWrite"),
        TOOL_APPLYPATCH("Tool: ApplyPatch"),
        TOOL_QUESTION("Tool: Question"),

        TOOL_PENDING("State: Pending"),
        TOOL_RUNNING("State: Running"),
        TOOL_ERROR("State: Error"),

        ERROR_RATE_LIMIT("Error: Rate Limit"),
        ERROR_AUTH("Error: Auth"),
        ERROR_ABORTED("Error: Aborted"),

        PERMISSION_REQUEST("Permission Request"),
        QUESTION_REQUEST("Question Request"),

        STREAMING_TEXT("Demo: Streaming"),
        TOOL_EXECUTION_FLOW("Demo: Tool Flow"),
        ALL_TOOLS("Demo: All Tools"),
        ALL_PARTS("Demo: All Parts");

        override fun toString() = displayName
    }
}
