package ai.kilocode.jetbrains.inline

import com.intellij.codeInsight.inline.completion.InlineCompletionEvent
import com.intellij.codeInsight.inline.completion.InlineCompletionProvider
import com.intellij.codeInsight.inline.completion.InlineCompletionProviderID
import com.intellij.codeInsight.inline.completion.InlineCompletionRequest
import com.intellij.codeInsight.inline.completion.elements.InlineCompletionGrayTextElement
import com.intellij.codeInsight.inline.completion.suggestion.InlineCompletionSingleSuggestion
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project

/**
 * IntelliJ inline completion provider that bridges to VSCode extension's Ghost service.
 * This provider uses the new InlineCompletionService which sends full file content
 * to the Ghost service via RPC for accurate completions.
 *
 * The provider handles triggering and rendering, while all AI logic (debouncing,
 * caching, context gathering, and telemetry) is handled by the Ghost service.
 */
class KiloCodeInlineCompletionProvider(
    private val handle: Int,
    private val project: Project,
    private val extensionId: String,
    private val displayName: String?,
) : InlineCompletionProvider {

    private val logger = Logger.getInstance(KiloCodeInlineCompletionProvider::class.java)
    private val completionService = InlineCompletionService.getInstance()

    /**
     * Custom insert handler that triggers telemetry when completions are accepted.
     * Overrides the default insertHandler from InlineCompletionProvider.
     */
    override val insertHandler = KiloCodeInlineCompletionInsertHandler(project)

    /**
     * Unique identifier for this provider.
     * Required by InlineCompletionProvider interface.
     */
    override val id: InlineCompletionProviderID = InlineCompletionProviderID("kilocode-inline-completion-$extensionId-$handle")

    /**
     * Gets inline completion suggestions using the Ghost service.
     * Sends full file content to ensure accurate completions.
     */
    override suspend fun getSuggestion(request: InlineCompletionRequest): InlineCompletionSingleSuggestion {
        try {
            // Get document and position information within a read action
            // We need to get the document reference here too for thread safety
            val positionInfo = ReadAction.compute<PositionInfo, Throwable> {
                val editor = request.editor
                val document = editor.document

                // Use request.endOffset which is the correct insertion point for the completion
                // This is where IntelliJ expects the completion to be inserted
                val completionOffset = request.endOffset

                // Calculate line and character position from the completion offset
                val line = document.getLineNumber(completionOffset)
                val lineStartOffset = document.getLineStartOffset(line)
                val char = completionOffset - lineStartOffset

                // Get language ID from file type
                val virtualFile = FileDocumentManager.getInstance().getFile(document)
                val langId = virtualFile?.fileType?.name?.lowercase() ?: "text"

                // Also get caret position for logging/debugging
                val caretOffset = editor.caretModel.offset

                PositionInfo(completionOffset, line, char, langId, document, caretOffset)
            }

            val (offset, lineNumber, character, languageId, document, caretOffset) = positionInfo

            // Call the new service with full file content
            val result = completionService.getInlineCompletions(
                project,
                document,
                lineNumber,
                character,
                languageId,
            )

            // Convert result to InlineCompletionSingleSuggestion using the new API
            return when (result) {
                is InlineCompletionService.Result.Success -> {
                    if (result.items.isEmpty()) {
                        // Return empty suggestion using builder
                        InlineCompletionSingleSuggestion.build { }
                    } else {
                        val firstItem = result.items[0]
                        InlineCompletionSingleSuggestion.build {
                            emit(InlineCompletionGrayTextElement(firstItem.insertText))
                        }
                    }
                }
                is InlineCompletionService.Result.Error -> {
                    InlineCompletionSingleSuggestion.build { }
                }
            }
        } catch (e: kotlinx.coroutines.CancellationException) {
            // Normal cancellation - user continued typing
            throw e // Re-throw to properly propagate cancellation
        } catch (e: java.util.concurrent.CancellationException) {
            // Java cancellation - also normal flow
            return InlineCompletionSingleSuggestion.build { }
        } catch (e: Exception) {
            // Check if this is a wrapped cancellation
            if (e.cause is kotlinx.coroutines.CancellationException ||
                e.cause is java.util.concurrent.CancellationException
            ) {
                return InlineCompletionSingleSuggestion.build { }
            }
            // Real error - log appropriately
            return InlineCompletionSingleSuggestion.build { }
        }
    }

    /**
     * Determines if this provider is enabled for the given event.
     * Document selector matching is handled during registration.
     */
    override fun isEnabled(event: InlineCompletionEvent): Boolean {
        return true
    }

    /**
     * Data class to hold position information calculated in read action
     */
    private data class PositionInfo(
        val offset: Int,
        val lineNumber: Int,
        val character: Int,
        val languageId: String,
        val document: com.intellij.openapi.editor.Document,
        val caretOffset: Int,
    )
}
