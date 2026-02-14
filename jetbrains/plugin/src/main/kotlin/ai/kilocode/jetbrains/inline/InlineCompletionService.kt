package ai.kilocode.jetbrains.inline

import ai.kilocode.jetbrains.core.PluginContext
import ai.kilocode.jetbrains.core.ServiceProxyRegistry
import ai.kilocode.jetbrains.i18n.I18n
import ai.kilocode.jetbrains.ipc.proxy.LazyPromise
import ai.kilocode.jetbrains.ipc.proxy.interfaces.ExtHostCommandsProxy
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.Document
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project
import kotlinx.coroutines.withTimeout
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference

/**
 * Service responsible for getting inline completions via RPC communication
 * with the VSCode extension's Autocomplete service. Encapsulates all RPC logic,
 * error handling, and result processing for inline completion generation.
 */
class InlineCompletionService {
    private val logger: Logger = Logger.getInstance(InlineCompletionService::class.java)
    
    /**
     * Tracks the current request ID to validate responses.
     * Only completions matching the current request ID will be shown.
     */
    private val currentRequestId = AtomicReference<String?>(null)

    /**
     * Result wrapper for inline completion operations.
     */
    sealed class Result {
        data class Success(val items: List<CompletionItem>) : Result()
        data class Error(val errorMessage: String) : Result()
    }

    /**
     * Completion item data class representing a single inline completion suggestion.
     */
    data class CompletionItem(
        val insertText: String,
        val range: Range?
    )

    /**
     * Range data class representing a text range in the document.
     */
    data class Range(
        val start: Position,
        val end: Position
    )

    /**
     * Position data class representing a cursor position in the document.
     */
    data class Position(
        val line: Int,
        val character: Int
    )

    /**
     * Gets inline completions using the VSCode extension via RPC.
     * Sends the full file content to ensure accurate completions.
     *
     * @param project The current project context
     * @param document The document to get completions for
     * @param line The line number (0-based)
     * @param character The character position (0-based)
     * @param languageId The language identifier (e.g., "kotlin", "java")
     * @return Result containing either the completion items or error information
     */
    suspend fun getInlineCompletions(
        project: Project,
        document: Document,
        line: Int,
        character: Int,
        languageId: String
    ): Result {
        return try {
            val proxy = getRPCProxy(project)
            if (proxy == null) {
                logger.error("Failed to get RPC proxy - extension not connected")
                return Result.Error(I18n.t("kilocode:inlineCompletion.errors.connectionFailed"))
            }

            // Generate unique request ID and mark it as current
            val requestId = UUID.randomUUID().toString()
            currentRequestId.set(requestId)
            val rpcResult = executeRPCCommand(proxy, document, line, character, languageId, requestId)
            processCommandResult(rpcResult, requestId)
        } catch (e: kotlinx.coroutines.TimeoutCancellationException) {
            logger.debug("Inline completion timed out after ${InlineCompletionConstants.RPC_TIMEOUT_MS}ms - returning empty result")
            Result.Success(emptyList())
        } catch (e: kotlinx.coroutines.CancellationException) {
            // Normal cancellation - user continued typing or request was superseded
            // This is expected behavior, not an error
            logger.debug("Inline completion cancelled (user continued typing)", e)
            Result.Success(emptyList()) // Return empty result, not an error
        } catch (e: java.util.concurrent.CancellationException) {
            // Java cancellation exception - also normal flow
            logger.debug("Inline completion cancelled (Java cancellation)", e)
            Result.Success(emptyList())
        } catch (e: Exception) {
            // Check if this is a wrapped cancellation exception
            if (e.cause is kotlinx.coroutines.CancellationException ||
                e.cause is java.util.concurrent.CancellationException ||
                e.message?.contains("cancelled", ignoreCase = true) == true) {
                logger.debug("Inline completion cancelled (wrapped exception): ${e.message}")
                return Result.Success(emptyList())
            }
            // Real error - log as warning and return empty result silently
            logger.warn("Inline completion failed: ${e.message}", e)
            Result.Success(emptyList())
        }
    }

    /**
     * Gets the RPC proxy for command execution from the project's PluginContext.
     */
    private fun getRPCProxy(project: Project): ExtHostCommandsProxy? {
        return project.getService(PluginContext::class.java)
            ?.getRPCProtocol()
            ?.getProxy(ServiceProxyRegistry.ExtHostContext.ExtHostCommands)
    }

    /**
     * Executes the inline completion command via RPC with timeout handling.
     * Sends the full document content to the VSCode extension.
     */
    private suspend fun executeRPCCommand(
        proxy: ExtHostCommandsProxy,
        document: Document,
        line: Int,
        character: Int,
        languageId: String,
        requestId: String
    ): Any? {
        // Get full file content
        val fileContent = document.text
        
        // Get the actual file path from the document
        val virtualFile = FileDocumentManager.getInstance().getFile(document)
        val documentUri = virtualFile?.path?.let { "file://$it" } ?: "file://jetbrains-document"
        
        // Prepare arguments for RPC call including request ID
        val args = listOf(
            documentUri,
            mapOf(
                "line" to line,
                "character" to character
            ),
            fileContent,
            languageId,
            requestId
        )

        val promise: LazyPromise = proxy.executeContributedCommand(
            InlineCompletionConstants.EXTERNAL_COMMAND_ID,
            args,
        )

        // Wait for the result with timeout
        val result = withTimeout(InlineCompletionConstants.RPC_TIMEOUT_MS) {
            promise.await()
        }
        
        return result
    }

    /**
     * Processes the result from the RPC command and returns appropriate Result.
     * Parses the response map and extracts completion items.
     */
    private fun processCommandResult(result: Any?, requestId: String): Result {
        // Handle invalid result format
        if (result !is Map<*, *>) {
            logger.warn("Received unexpected response format: ${result?.javaClass?.simpleName}, result: $result")
            return Result.Success(emptyList())
        }

        // Extract response data including request ID
        val responseRequestId = result["requestId"] as? String
        val items = result["items"] as? List<*>
        val error = result["error"] as? String

        // Validate request ID - only process if it matches the current request
        val current = currentRequestId.get()
        if (responseRequestId != current) {
            logger.info("Discarding stale completion: response requestId=$responseRequestId, current=$current")
            return Result.Success(emptyList())
        }
        
        // Handle error response
        if (error != null) {
            logger.warn("Inline completion failed with error: $error")
            return Result.Success(emptyList())
        }

        // Handle missing items
        if (items == null) {
            logger.warn("Received response without items or error field")
            return Result.Success(emptyList())
        }

        // Parse completion items
        val completionItems = items.mapNotNull { item ->
            if (item is Map<*, *>) {
                val insertText = item["insertText"] as? String
                if (insertText == null) {
                    logger.warn("  Item missing insertText, skipping")
                    return@mapNotNull null
                }
                val rangeMap = item["range"] as? Map<*, *>
                val range = rangeMap?.let {
                    val start = it["start"] as? Map<*, *>
                    val end = it["end"] as? Map<*, *>
                    if (start != null && end != null) {
                        Range(
                            Position(
                                (start["line"] as? Number)?.toInt() ?: 0,
                                (start["character"] as? Number)?.toInt() ?: 0
                            ),
                            Position(
                                (end["line"] as? Number)?.toInt() ?: 0,
                                (end["character"] as? Number)?.toInt() ?: 0
                            )
                        )
                    } else null
                }
                CompletionItem(insertText, range)
            } else {
                logger.warn("  Item is not a Map, skipping")
                null
            }
        }

        // Success case
        return Result.Success(completionItems)
    }

    companion object {
        /**
         * Gets or creates the InlineCompletionService instance.
         */
        fun getInstance(): InlineCompletionService {
            return ApplicationManager.getApplication().getService(InlineCompletionService::class.java)
        }
    }
}