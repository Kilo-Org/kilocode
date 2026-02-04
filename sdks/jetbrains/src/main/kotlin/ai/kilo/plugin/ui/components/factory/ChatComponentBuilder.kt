package ai.kilo.plugin.ui.components.factory

import ai.kilo.plugin.model.*
import ai.kilo.plugin.ui.KiloSpacing
import ai.kilo.plugin.ui.KiloTheme
import ai.kilo.plugin.ui.components.chat.message.*
import ai.kilo.plugin.ui.components.chat.message.parts.*
import com.intellij.openapi.project.Project
import com.intellij.ui.components.JBLabel
import java.awt.Component
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.JComponent
import javax.swing.JPanel

/**
 * Holds pending permission and question requests for rendering.
 */
data class PendingRequests(
    val permissions: List<PermissionRequest> = emptyList(),
    val questions: List<QuestionRequest> = emptyList()
) {
    fun getPermissionForTool(callID: String?): PermissionRequest? {
        if (callID == null) return null
        return permissions.find { it.tool?.callID == callID }
    }

    fun getQuestionForTool(callID: String?): QuestionRequest? {
        if (callID == null) return null
        return questions.find { it.tool?.callID == callID }
    }
}

/**
 * Builds Swing components from chat domain models (MessageWithParts, Part).
 */
object ChatComponentBuilder {

    fun createMessageBlock(
        project: Project,
        messageWithParts: MessageWithParts,
        pendingRequests: PendingRequests,
        sessionStartTime: Long?,
        agentColor: java.awt.Color,
        onPermissionReply: (requestId: String, reply: String) -> Unit,
        onQuestionReply: (requestId: String, answers: List<List<String>>) -> Unit,
        onQuestionReject: (requestId: String) -> Unit,
        toolPartWrappers: MutableList<ToolPartWrapper>,
        textPartCache: MutableMap<String, MarkdownPanel>,
        onFork: ((String) -> Unit)? = null,
        onRevert: ((String) -> Unit)? = null
    ): ChatContentBlock {
        val message = messageWithParts.info
        val entityType = if (message.isUser) {
            SessionEntityType.UserMessage(
                agent = message.agent,
                modelId = message.model?.modelID,
                providerId = message.model?.providerID
            )
        } else {
            SessionEntityType.AssistantMessage(message.modelID)
        }

        val content = createMessageContent(
            project, messageWithParts, pendingRequests, sessionStartTime,
            onPermissionReply, onQuestionReply, onQuestionReject,
            toolPartWrappers, textPartCache
        )

        // Build footer info with token usage and copyable text
        val footerInfo = buildFooterInfo(message, messageWithParts.parts)

        return ChatContentBlock(
            entityType = entityType,
            content = content,
            timestamp = message.time.created,
            sessionStartTime = sessionStartTime,
            footerInfo = footerInfo
        )
    }

    private fun buildFooterInfo(message: ai.kilo.plugin.model.Message, parts: List<ai.kilo.plugin.model.Part>): BlockFooterInfo? {
        val tokens = message.tokens

        // Extract all text content for copy button
        val textContent = parts
            .filter { it.type == "text" && !it.text.isNullOrBlank() }
            .mapNotNull { it.text }
            .joinToString("\n\n")
            .takeIf { it.isNotBlank() }

        // Only create footer if there's something to show
        if (tokens == null && textContent == null) {
            return null
        }

        return BlockFooterInfo(
            inputTokens = tokens?.input?.takeIf { it > 0 },
            outputTokens = tokens?.output?.takeIf { it > 0 },
            cacheReadTokens = tokens?.cache?.read?.takeIf { it > 0 },
            cacheWriteTokens = tokens?.cache?.write?.takeIf { it > 0 },
            copyableContent = textContent
        )
    }

    private fun createMessageContent(
        project: Project,
        messageWithParts: MessageWithParts,
        pendingRequests: PendingRequests,
        sessionStartTime: Long?,
        onPermissionReply: (requestId: String, reply: String) -> Unit,
        onQuestionReply: (requestId: String, answers: List<List<String>>) -> Unit,
        onQuestionReject: (requestId: String) -> Unit,
        toolPartWrappers: MutableList<ToolPartWrapper>,
        textPartCache: MutableMap<String, MarkdownPanel>
    ): JComponent {
        val contentPanel = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = false
        }

        val messageTimestamp = messageWithParts.info.time.created

        for (part in messageWithParts.parts) {
            // Skip step markers - they're internal API boundaries
            if (part.type == "step-start" || part.type == "step-finish") continue

            val partView = createPartContent(
                project, part, pendingRequests, messageTimestamp, sessionStartTime,
                onPermissionReply, onQuestionReply, onQuestionReject,
                toolPartWrappers, textPartCache
            )
            partView.alignmentX = Component.LEFT_ALIGNMENT
            contentPanel.add(partView)
            contentPanel.add(Box.createVerticalStrut(KiloSpacing.md))
        }

        return contentPanel
    }

    private fun createPartContent(
        project: Project,
        part: Part,
        pendingRequests: PendingRequests,
        messageTimestamp: Long,
        sessionStartTime: Long?,
        onPermissionReply: (requestId: String, reply: String) -> Unit,
        onQuestionReply: (requestId: String, answers: List<List<String>>) -> Unit,
        onQuestionReject: (requestId: String) -> Unit,
        toolPartWrappers: MutableList<ToolPartWrapper>,
        textPartCache: MutableMap<String, MarkdownPanel>
    ): JComponent {
        val (entityType, content) = when (part.type) {
            "text" -> {
                val markdownPanel = MarkdownPanel(project).apply {
                    isOpaque = false
                    setMarkdown(part.text ?: "")
                }
                textPartCache[part.id] = markdownPanel
                SessionEntityType.Text(part.callID) to markdownPanel
            }
            "tool" -> {
                val permission = pendingRequests.getPermissionForTool(part.callID)
                val question = pendingRequests.getQuestionForTool(part.callID)
                val toolContent = createToolContent(part, permission, question, onPermissionReply, onQuestionReply, onQuestionReject, toolPartWrappers)

                val entityType = when {
                    permission != null -> SessionEntityType.Permission(permission.id, part.tool)
                    question != null -> SessionEntityType.Question(question.id, part.tool, question.questions?.firstOrNull()?.question)
                    else -> getToolEntityType(part)
                }
                entityType to toolContent
            }
            "reasoning" -> {
                val reasoningText = part.text ?: ""
                val content = JBLabel("<html>${reasoningText.take(500)}${if (reasoningText.length > 500) "..." else ""}</html>").apply {
                    foreground = KiloTheme.textWeak
                }
                SessionEntityType.Reasoning(part.callID) to content
            }
            else -> {
                val content = JBLabel("Unknown part data").apply {
                    foreground = KiloTheme.textWeak
                }
                SessionEntityType.Unknown(part.type, part.callID) to content
            }
        }

        return ChatContentBlock(
            entityType = entityType,
            content = content,
            timestamp = messageTimestamp,
            sessionStartTime = sessionStartTime
            // No footerInfo for parts - only message-level gets footer
        )
    }

    private fun getToolEntityType(part: Part): SessionEntityType {
        val toolName = part.tool ?: "Unknown"
        val callId = part.callID

        return when (toolName.lowercase()) {
            "read" -> SessionEntityType.ToolRead(callId, part.metadata?.get("file_path")?.toString()?.trim('"'))
            "write" -> SessionEntityType.ToolWrite(callId, part.metadata?.get("file_path")?.toString()?.trim('"'))
            "edit" -> SessionEntityType.ToolEdit(callId, part.metadata?.get("file_path")?.toString()?.trim('"'))
            "bash" -> SessionEntityType.ToolBash(callId, part.metadata?.get("command")?.toString()?.trim('"'))
            "glob" -> SessionEntityType.ToolGlob(callId, part.metadata?.get("pattern")?.toString()?.trim('"'))
            "grep" -> SessionEntityType.ToolGrep(callId, part.metadata?.get("pattern")?.toString()?.trim('"'))
            "ls", "list" -> SessionEntityType.ToolList(callId, part.metadata?.get("path")?.toString()?.trim('"'))
            "webfetch" -> SessionEntityType.ToolWebFetch(callId, part.metadata?.get("url")?.toString()?.trim('"'))
            "websearch" -> SessionEntityType.ToolWebSearch(callId, part.metadata?.get("query")?.toString()?.trim('"'))
            "task" -> SessionEntityType.ToolTask(callId, part.metadata?.get("description")?.toString()?.trim('"'))
            "todoread" -> SessionEntityType.ToolTodoRead(callId)
            "todowrite" -> SessionEntityType.ToolTodoWrite(callId)
            "applypatch" -> SessionEntityType.ToolApplyPatch(callId)
            else -> SessionEntityType.ToolGeneric(callId, toolName)
        }
    }

    private fun createToolContent(
        part: Part,
        permission: PermissionRequest?,
        question: QuestionRequest?,
        onPermissionReply: (requestId: String, reply: String) -> Unit,
        onQuestionReply: (requestId: String, answers: List<List<String>>) -> Unit,
        onQuestionReject: (requestId: String) -> Unit,
        toolPartWrappers: MutableList<ToolPartWrapper>
    ): JComponent {
        // Question: use simple InlineQuestionPrompt directly
        if (question != null) {
            return InlineQuestionPrompt(
                request = question,
                onReply = { answers -> onQuestionReply(question.id, answers) },
                onReject = { onQuestionReject(question.id) }
            )
        }

        // Permission: use simple InlinePermissionPrompt directly
        if (permission != null) {
            return InlinePermissionPrompt(
                request = permission,
                onReply = { reply -> onPermissionReply(permission.id, reply) }
            )
        }

        return CollapsibleToolPanel(part)
    }
}
