package ai.kilocode.client.session.ui.prompt

import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.app.Workspace
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.rpc.dto.CommandDto
import ai.kilocode.rpc.dto.FileSearchResultDto
import ai.kilocode.rpc.dto.WorkspaceFileDto
import com.intellij.codeInsight.completion.CompletionParameters
import com.intellij.codeInsight.completion.CompletionResultSet
import com.intellij.codeInsight.completion.InsertionContext
import com.intellij.codeInsight.completion.PlainPrefixMatcher
import com.intellij.codeInsight.completion.PrioritizedLookupElement
import com.intellij.codeInsight.lookup.AutoCompletionPolicy
import com.intellij.codeInsight.lookup.CharFilter
import com.intellij.codeInsight.lookup.LookupElement
import com.intellij.codeInsight.lookup.LookupElementBuilder
import com.intellij.icons.AllIcons
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.progress.runBlockingCancellable
import com.intellij.util.textCompletion.TextCompletionProvider
import java.util.Collections
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

class KiloPromptCompletionProvider(
    private val workspace: Workspace,
    private val service: KiloWorkspaceService,
    private val actions: List<SlashAction>,
    private val mentions: List<MentionAction>,
    private val scope: CoroutineScope,
) : TextCompletionProvider, DumbAware {
    private val paths = Collections.synchronizedSet(mutableSetOf<String>())
    private val exists = Collections.synchronizedMap(mutableMapOf<String, Boolean>())
    private val pending = Collections.synchronizedSet(mutableSetOf<String>())
    private val cache: MutableMap<String, FileSearchResultDto> = Collections.synchronizedMap(
        object : LinkedHashMap<String, FileSearchResultDto>(64, 0.75f, true) {
            override fun removeEldestEntry(eldest: Map.Entry<String, FileSearchResultDto>) = size > 64
        },
    )

    data class Highlight(val start: Int, val end: Int, val kind: HighlightKind)

    enum class HighlightKind { MENTION, COMMAND, INVALID }

    /** A file mention token at a caret/mouse offset, with whether it resolves to a real file. */
    data class MentionHit(val start: Int, val end: Int, val value: String, val resolved: Boolean)

    /**
     * The file mention spanning [offset], or null when the offset is outside a mention,
     * on a special (`@git-changes`) token, or on a mention not yet validated.
     */
    fun mentionAt(text: String, offset: Int): MentionHit? {
        val span = mentionSpans(text).firstOrNull { offset in it.start..it.end } ?: return null
        if (span.value in mentionNames()) return null
        val resolved = span.value in paths || exists[span.value] == true
        if (!resolved && exists[span.value] != false) return null
        return MentionHit(span.start, span.end, span.value, resolved)
    }

    /** Open a resolved file mention using the workspace's go-to-file plumbing. */
    fun navigate(value: String) {
        scope.launch { service.openPath(workspace.directory, value) }
    }

    fun clearMentions() {
        paths.clear()
        exists.clear()
        pending.clear()
        cache.clear()
    }

    fun prewarm() {
        scope.launch {
            if (cache.containsKey("")) return@launch
            val result = service.searchFiles(workspace.directory, "", 50)
            if (result.files.isNotEmpty() || result.git) cache.putIfAbsent("", result)
        }
    }

    fun inside(text: String, caret: Int): Boolean = mentionSpans(text).any { span -> caret in span.start..span.end }

    private fun clientTokens(): Set<String> = actions.flatMapTo(mutableSetOf()) { action ->
        listOf(action.name) + action.hints
    }

    fun clientAction(text: String): SlashAction? {
        val name = commandName(text) ?: return null
        return actions.firstOrNull { action -> name == action.name || name in action.hints }
    }

    fun mentionNames(): Set<String> = mentions.mapTo(mutableSetOf()) { it.name }

    fun serverCommand(text: String): Pair<String, String>? {
        val name = commandName(text) ?: return null
        if (actions.any { action -> name == action.name || name in action.hints }) return null
        if (workspace.state.value.commands.none { it.name == name }) return null
        val raw = text.trimStart()
        return name to raw.drop(name.length + 1).trimStart()
    }

    fun highlights(text: String, caret: Int = -1): List<Highlight> = buildList {
        val command = text.takeIf { it.startsWith('/') }
            ?.drop(1)
            ?.takeWhile { !it.isWhitespace() }
            ?.takeIf { it.isNotBlank() }
        val commands = workspace.state.value.commands.mapTo(mutableSetOf()) { it.name }
        if (command != null && (clientAction("/$command") != null || command in commands)) {
            add(Highlight(0, command.length + 1, HighlightKind.COMMAND))
        }

        mentionSpans(text).forEach { span ->
            val under = caret in span.start..span.end
            when {
                span.value in mentionNames() -> add(Highlight(span.start, span.end, HighlightKind.MENTION))
                span.value in paths || exists[span.value] == true -> add(Highlight(span.start, span.end, HighlightKind.MENTION))
                under -> Unit
                exists[span.value] == false -> add(Highlight(span.start, span.end, HighlightKind.INVALID))
            }
        }
    }

    fun validate(text: String, caret: Int, onResolved: () -> Unit) {
        mentionSpans(text).forEach { span ->
            val value = span.value
            if (value in mentionNames()) return@forEach
            if (value in paths) return@forEach
            if (caret in span.start..span.end) return@forEach
            if (exists.containsKey(value)) return@forEach
            if (!pending.add(value)) return@forEach
            scope.launch {
                val ok = runCatching { service.files(workspace.directory, value).isNotEmpty() }.getOrDefault(false)
                exists[value] = ok
                pending.remove(value)
                onResolved()
            }
        }
    }

    override fun getAdvertisement(): String? = null

    override fun getPrefix(text: String, offset: Int): String? = token(text, offset)?.prefix

    override fun applyPrefixMatcher(result: CompletionResultSet, prefix: String): CompletionResultSet =
        result.withPrefixMatcher(PlainPrefixMatcher(prefix)).caseInsensitive()

    override fun acceptChar(c: Char): CharFilter.Result = when {
        c.isWhitespace() -> CharFilter.Result.HIDE_LOOKUP
        else -> CharFilter.Result.ADD_TO_PREFIX
    }

    override fun fillCompletionVariants(parameters: CompletionParameters, prefix: String, result: CompletionResultSet) {
        when (token(parameters.originalFile.text, parameters.offset)?.kind) {
            Kind.SLASH -> slash(prefix, result)
            Kind.MENTION -> mention(prefix, result)
            null -> Unit
        }
        result.stopHere()
    }

    private fun slash(prefix: String, result: CompletionResultSet) {
        result.restartCompletionOnAnyPrefixChange()
        val out = result.withPrefixMatcher(PlainPrefixMatcher.ALWAYS_TRUE)
        val names = clientTokens()
        val clients = actions.filter { action -> matches(prefix, action.name, action.hints) }
        clients.forEach { action -> out.addElement(client(action)) }
        val commands = workspace.state.value.commands
            .filter { it.name !in names && matches(prefix, it.name, it.hints) }
        commands.forEach { command -> out.addElement(server(command)) }
        if (clients.isNotEmpty() || commands.isNotEmpty()) return
        result.withPrefixMatcher(PlainPrefixMatcher.ALWAYS_TRUE)
            .addElement(info(prefix, KiloBundle.message("prompt.completion.noMatches")))
    }

    private fun mention(prefix: String, result: CompletionResultSet) {
        result.restartCompletionOnAnyPrefixChange()
        val out = result.withPrefixMatcher(PlainPrefixMatcher.ALWAYS_TRUE)
        val search = search(prefix)
        val known = mentions.filter { action -> matches(prefix, action.name, action.hints) && action.available(search) }
        known.forEach { action -> out.addElement(prioritize(resource(action))) }
        if (search.indexing) {
            val msg = KiloBundle.message("prompt.mention.indexing")
            result.addLookupAdvertisement(msg)
            out.addElement(info(prefix, msg))
            return
        }
        search.files.forEach { file -> out.addElement(file(file)) }
        if (known.isEmpty() && search.files.isEmpty()) {
            val msg = KiloBundle.message("prompt.completion.noMatches")
            out.addElement(info(prefix, msg))
        }
    }

    private fun search(prefix: String): FileSearchResultDto = cache[prefix] ?: fetch(prefix)

    private fun fetch(prefix: String): FileSearchResultDto {
        val result = runBlockingCancellable { service.searchFiles(workspace.directory, prefix, 50) }
        cache[prefix] = result
        return result
    }

    private fun info(prefix: String, msg: String): LookupElement = LookupElementBuilder.create(msg)
        .withPresentableText(msg)
        .withIcon(AllIcons.General.Information)
        .withInsertHandler { ctx, _ ->
            val start = (ctx.startOffset - prefix.length).coerceAtLeast(0)
            val tail = ctx.tailOffset.coerceAtMost(ctx.document.textLength)
            val end = (tail until ctx.document.textLength).firstOrNull { ctx.document.text[it].isWhitespace() }
                ?: ctx.document.textLength
            ctx.document.replaceString(start, end, prefix)
            ctx.editor.caretModel.moveToOffset(start + prefix.length)
        }
        .withAutoCompletionPolicy(AutoCompletionPolicy.NEVER_AUTOCOMPLETE)

    private fun matches(prefix: String, name: String, hints: List<String>): Boolean =
        (listOf(name) + hints).any { it.startsWith(prefix, ignoreCase = true) }

    private fun commandName(text: String): String? {
        val raw = text.trimStart()
        if (!raw.startsWith('/')) return null
        return raw.drop(1).takeWhile { !it.isWhitespace() }.takeIf { it.isNotBlank() }
    }

    private fun client(action: SlashAction): LookupElement = LookupElementBuilder.create(action.name)
        .withPresentableText("/${action.name}")
        .withTailText("  ${action.description}", true)
        .withLookupStrings(action.hints)
        .withIcon(AllIcons.Actions.Execute)
        .withInsertHandler { ctx, _ ->
            ctx.document.setText("")
            ApplicationManager.getApplication().invokeLater { action.action() }
        }

    private fun server(command: CommandDto): LookupElement = LookupElementBuilder.create(command.name)
        .withPresentableText("/${command.name}")
        .withTailText(command.description?.let { "  $it" } ?: "", true)
        .withTypeText(command.source)
        .withLookupStrings(command.hints)
        .withIcon(AllIcons.Nodes.Function)
        .withInsertHandler { ctx, _ -> replace(ctx, "/${command.name} ", false) }

    private fun resource(action: MentionAction): LookupElement = LookupElementBuilder.create(action.name)
        .withPresentableText("@${action.name}")
        .withTailText("  ${action.description}", true)
        .withLookupStrings(action.hints)
        .withIcon(AllIcons.Nodes.Tag)
        .withInsertHandler { ctx, _ -> replace(ctx, "@${action.name} ", false) }

    private fun prioritize(element: LookupElement): LookupElement =
        PrioritizedLookupElement.withGrouping(PrioritizedLookupElement.withPriority(element, 100.0), 100)

    private fun file(file: WorkspaceFileDto): LookupElement = LookupElementBuilder.create(file.path)
        .withPresentableText("@${file.path}")
        .withTailText(parent(file.path), true)
        .withIcon(icon(file))
        .withLookupString(file.name)
        .withInsertHandler { ctx, _ -> replace(ctx, "@${file.path} ", true, file.path) }

    private fun icon(file: WorkspaceFileDto) = when {
        file.directory -> AllIcons.Nodes.Folder
        else -> FileTypeManager.getInstance().getFileTypeByFileName(file.name).icon ?: AllIcons.FileTypes.Text
    }

    private fun replace(ctx: InsertionContext, value: String, trim: Boolean, path: String? = null) {
        val text = ctx.document.text
        val offset = ctx.startOffset.coerceAtMost(text.length)
        val start = (offset - 1 downTo 0).firstOrNull { text[it].isWhitespace() }?.plus(1) ?: 0
        val end = tokenEnd(text, start)
        val next = text.getOrNull(end)
        val insert = if (trim && next?.isWhitespace() == true) value.trimEnd() else value
        path?.let {
            paths.add(it)
            exists[it] = true
        }
        ctx.document.replaceString(start, end, insert)
        ctx.editor.caretModel.moveToOffset(start + insert.length)
    }

    private fun tokenEnd(text: String, start: Int): Int =
        (start until text.length).firstOrNull { text[it].isWhitespace() } ?: text.length

    private fun parent(path: String): String {
        val idx = path.lastIndexOf('/')
        if (idx <= 0) return ""
        return "  ${path.substring(0, idx)}"
    }

    private fun token(text: String, offset: Int): Token? {
        val pos = offset.coerceIn(0, text.length)
        val start = (pos - 1 downTo 0).firstOrNull { text[it].isWhitespace() }?.plus(1) ?: 0
        val end = (pos until text.length).firstOrNull { text[it].isWhitespace() } ?: text.length
        val head = text.substring(start, pos)
        val raw = text.substring(start, end)
        if (raw.startsWith("/") && text.take(start).isBlank() && raw.indexOf(' ') < 0) return Token(Kind.SLASH, head.drop(1))
        if (raw.startsWith("@") && raw.indexOf(' ') < 0) return Token(Kind.MENTION, head.drop(1))
        return null
    }

    private data class Token(val kind: Kind, val prefix: String)

    private fun mentionSpans(text: String): List<Mention> = promptMentions(text)

    private enum class Kind { SLASH, MENTION }
}
