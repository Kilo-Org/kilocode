package ai.kilo.plugin.toolwindow.components.chat

import ai.kilo.plugin.model.MessageWithParts
import ai.kilo.plugin.services.ChatUiStateManager
import ai.kilo.plugin.toolwindow.KiloSpacing
import ai.kilo.plugin.toolwindow.KiloTheme
import ai.kilo.plugin.toolwindow.components.SessionEntityUIBlock
import ai.kilo.plugin.toolwindow.components.factory.SessionEntityFactory
import com.intellij.openapi.project.Project
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import java.awt.Component
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.JPanel

/**
 * Handles rendering of chat messages to the messages panel.
 */
class ChatMessageRenderer(
    private val project: Project,
    private val scope: CoroutineScope,
    private val store: ChatUiStateManager,
    private val stateManager: ChatStateManager,
    private val messagesPanel: JPanel
) {

    fun fullRebuild(messages: List<MessageWithParts>) {
        println("DEBUG ChatMessageRenderer.fullRebuild: rebuilding ${messages.size} messages")
        stateManager.toolPartWrappers.forEach { it.dispose() }
        stateManager.toolPartWrappers.clear()
        stateManager.textPartCache.clear()
        stateManager.messageViewCache.clear()

        messagesPanel.removeAll()

        for (messageWithParts in messages) {
            val messageBlock = createMessageBlock(messageWithParts)
            messageBlock.alignmentX = Component.LEFT_ALIGNMENT
            stateManager.messageViewCache[messageWithParts.info.id] = messageBlock
            messagesPanel.add(messageBlock)
            messagesPanel.add(Box.createVerticalStrut(KiloSpacing.xxl))
        }

        messagesPanel.add(Box.createVerticalGlue())
        messagesPanel.revalidate()
        messagesPanel.repaint()
    }

    fun appendNewMessages(messages: List<MessageWithParts>, fromIndex: Int) {
        // Remove the glue at the end
        val componentCount = messagesPanel.componentCount
        if (componentCount > 0 && messagesPanel.getComponent(componentCount - 1) is Box.Filler) {
            messagesPanel.remove(componentCount - 1)
        }

        // Add new messages
        for (i in fromIndex until messages.size) {
            val messageWithParts = messages[i]
            val messageBlock = createMessageBlock(messageWithParts)
            messageBlock.alignmentX = Component.LEFT_ALIGNMENT
            stateManager.messageViewCache[messageWithParts.info.id] = messageBlock
            messagesPanel.add(messageBlock)
            messagesPanel.add(Box.createVerticalStrut(KiloSpacing.xxl))
        }

        // Add glue back
        messagesPanel.add(Box.createVerticalGlue())
        messagesPanel.revalidate()
        messagesPanel.repaint()
    }

    fun refreshMessageView(messageId: String) {
        println("DEBUG ChatMessageRenderer.refreshMessageView: messageId=$messageId")
        val sessionId = stateManager.currentSessionId ?: return

        val message = store.getMessage(sessionId, messageId) ?: return
        val parts = store.getPartsForMessage(messageId)
        val messageWithParts = MessageWithParts(info = message, parts = parts)

        val oldView = stateManager.messageViewCache.remove(messageId)
        if (oldView != null) {
            println("DEBUG refreshMessageView: REBUILDING message block with ${parts.size} parts")
            val newView = createMessageBlock(messageWithParts)
            stateManager.messageViewCache[messageId] = newView
            replaceMessageView(oldView, newView)
        }
    }

    private fun createMessageBlock(messageWithParts: MessageWithParts): SessionEntityUIBlock {
        return SessionEntityFactory.createMessageBlock(
            project = project,
            messageWithParts = messageWithParts,
            pendingRequests = stateManager.pendingRequests,
            sessionStartTime = stateManager.currentSessionStartTime,
            agentColor = KiloTheme.getAgentColor(stateManager.currentAgent),
            onPermissionReply = { requestId, reply ->
                scope.launch { store.replyPermission(requestId, reply) }
            },
            onQuestionReply = { requestId, answers ->
                scope.launch { store.replyQuestion(requestId, answers) }
            },
            onQuestionReject = { requestId ->
                scope.launch { store.rejectQuestion(requestId) }
            },
            toolPartWrappers = stateManager.toolPartWrappers,
            textPartCache = stateManager.textPartCache,
            onFork = { msgId ->
                stateManager.currentSessionId?.let { sessionId ->
                    scope.launch { store.forkSession(sessionId, msgId) }
                }
            },
            onRevert = { msgId ->
                stateManager.currentSessionId?.let { sessionId ->
                    scope.launch { store.revertToMessage(sessionId, msgId, restoreFiles = true) }
                }
            }
        )
    }

    private fun replaceMessageView(oldView: SessionEntityUIBlock, newView: SessionEntityUIBlock) {
        val index = messagesPanel.components.indexOf(oldView)
        if (index >= 0) {
            newView.alignmentX = Component.LEFT_ALIGNMENT
            messagesPanel.remove(index)
            messagesPanel.add(newView, index)
            messagesPanel.revalidate()
            messagesPanel.repaint()
        }
    }

    fun clearPanel() {
        messagesPanel.removeAll()
        messagesPanel.revalidate()
        messagesPanel.repaint()
    }
}
