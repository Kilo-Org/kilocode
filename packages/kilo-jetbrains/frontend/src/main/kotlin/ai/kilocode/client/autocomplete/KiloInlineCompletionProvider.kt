package ai.kilocode.client.autocomplete

import ai.kilocode.client.KiloNotifications
import ai.kilocode.client.app.kiloRoot
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.context.KiloIgnoreCache
import ai.kilocode.rpc.KiloEditorRpcApi
import com.intellij.codeInsight.inline.completion.DebouncedInlineCompletionProvider
import com.intellij.codeInsight.inline.completion.InlineCompletionEvent
import com.intellij.codeInsight.inline.completion.InlineCompletionProviderID
import com.intellij.codeInsight.inline.completion.InlineCompletionRequest
import com.intellij.codeInsight.inline.completion.elements.InlineCompletionGrayTextElement
import com.intellij.codeInsight.inline.completion.suggestion.InlineCompletionSingleSuggestion
import com.intellij.codeInsight.inline.completion.suggestion.InlineCompletionSuggestion
import com.intellij.openapi.application.readAction
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.EditorKind
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.util.io.FileUtil
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds
import kotlin.time.TimeMark
import kotlin.time.TimeSource

internal val KILO_INLINE_ID = InlineCompletionProviderID("ai.kilocode.inlineCompletion")

internal class KiloInlineCompletionProvider : DebouncedInlineCompletionProvider() {
    override val id = KILO_INLINE_ID

    @Volatile private var lastFailure: TimeMark? = null

    @RequiresEdt
    override fun isEnabled(event: InlineCompletionEvent): Boolean {
        val editor = when (event) {
            is InlineCompletionEvent.DirectCall -> event.editor
            is InlineCompletionEvent.ManualCall -> event.editor
            is InlineCompletionEvent.DocumentChange -> {
                if (KiloAutocompleteSettingsService.getInstance().getState().enableAutoTrigger == false ||
                    lastFailure?.elapsedNow()?.let { it < 30.seconds } == true) return false
                event.editor
            }
            else -> return false
        }
        return editable(editor)
    }

    @RequiresEdt
    private fun editable(editor: Editor) = !editor.isDisposed && !editor.isViewer && editor.project != null &&
        editor.editorKind == EditorKind.MAIN_EDITOR && editor.caretModel.caretCount == 1 && !editor.selectionModel.hasSelection()

    override suspend fun getDebounceDelay(request: InlineCompletionRequest) = 350.milliseconds

    override suspend fun getSuggestionDebounced(request: InlineCompletionRequest): InlineCompletionSuggestion = withContext(Dispatchers.Default) {
        val project = request.editor.project ?: return@withContext InlineCompletionSuggestion.Empty
        val directory = project.kiloRoot() ?: return@withContext InlineCompletionSuggestion.Empty
        val context = readAction {
            val file = FileDocumentManager.getInstance().getFile(request.document) ?: return@readAction null
            if (file.fileType.isBinary || !file.isValid) return@readAction null
            // The VFS can expose the frontend path or the host's resolved path in remote projects.
            val root = generateSequence(file.parent) { it.parent }.firstOrNull {
                FileUtil.pathsEqual(it.path, directory) || FileUtil.pathsEqual(it.path, project.basePath)
            }
                ?: return@readAction null
            val relative = VfsUtilCore.getRelativePath(file, root) ?: return@readAction null
            if (project.service<KiloIgnoreCache>().matcher(root).ignored(relative)) return@readAction null
            fimContext(request.document.immutableCharSequence, request.endOffset)
        } ?: return@withContext InlineCompletionSuggestion.Empty
        val text = try {
            KiloEditorRpcApi.getInstance().complete(directory, context.first, context.second, KiloAutocompleteSettingsService.getInstance().getState().directMistral)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // A missing provider key or quota failure must not trigger a request on every keystroke.
            lastFailure = TimeSource.Monotonic.markNow()
            if (request.event is InlineCompletionEvent.ManualCall) withContext(Dispatchers.Main) {
                KiloNotifications.warning(project, KiloBundle.message("settings.autocomplete.title"), e.localizedMessage)
            }
            return@withContext InlineCompletionSuggestion.Empty
        }
        lastFailure = null
        if (text.isBlank() || context.second.startsWith(text)) return@withContext InlineCompletionSuggestion.Empty
        InlineCompletionSingleSuggestion.build { emit(InlineCompletionGrayTextElement(text)) }
    }
}

/** Bound the split RPC payload without making a copy of the entire editor buffer. */
internal fun fimContext(document: CharSequence, offset: Int): Pair<String, String>? {
    if (offset !in 0..document.length) return null
    val prefix = document.subSequence(maxOf(0, offset - 8_192), offset).toString()
    val suffix = document.subSequence(offset, minOf(document.length, offset + 4_096)).toString()
    return if (prefix.isBlank() && suffix.isBlank()) null else prefix to suffix
}
