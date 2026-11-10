@file:Suppress("TooManyFunctions", "NestedBlockDepth", "ReturnCount", "LoopWithTooManyJumpStatements", "MagicNumber")

package ai.kilocode.client.session.ui.search

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.scroll.SessionScroll
import ai.kilocode.client.session.ui.SessionMessageListPanel
import com.intellij.find.FindModel
import com.intellij.find.SearchReplaceComponent
import com.intellij.find.SearchSession
import com.intellij.find.editorHeaderActions.NextOccurrenceAction
import com.intellij.find.editorHeaderActions.PrevOccurrenceAction
import com.intellij.find.editorHeaderActions.StatusTextAction
import com.intellij.find.editorHeaderActions.ToggleMatchCase
import com.intellij.find.editorHeaderActions.ToggleRegex
import com.intellij.find.editorHeaderActions.ToggleWholeWordsOnlyAction
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CustomShortcutSet
import com.intellij.openapi.actionSystem.DataKey
import com.intellij.openapi.actionSystem.IdeActions
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.EDT
import com.intellij.openapi.keymap.KeymapUtil
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.TextRange
import com.intellij.openapi.wm.IdeFocusManager
import com.intellij.ui.components.panels.NonOpaquePanel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import ai.kilocode.client.ui.md.MdSearchView
import ai.kilocode.client.ui.md.MdView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.awt.BorderLayout
import java.util.WeakHashMap
import java.awt.Rectangle
import javax.swing.JComponent
import javax.swing.SwingUtilities

internal object SessionSearchKeys {
    val SEARCH: DataKey<SessionSearch> = DataKey.create("kilo.session.transcript.search")
}

private const val DEBOUNCE_QUERY_MS = 60L
private const val DEBOUNCE_CONTENT_MS = 120L
private const val NANOS_PER_MS = 1_000_000L

/**
 * Transcript-scoped IntelliJ Find.
 *
 * The native [SearchReplaceComponent] owns the field, option toggles, counter, and previous/next
 * arrows; this class supplies the frontend-local result set and body highlights. It never searches
 * raw markdown, inner blocks, or the composer, and it never persists query text.
 */
internal class SessionSearch(
    private val project: Project,
    private val owner: JComponent,
    private val panel: SessionMessageListPanel,
    private val scroll: SessionScroll,
    private val scope: CoroutineScope,
    private val focusFallback: () -> JComponent?,
) : Disposable, SearchSession {
    val host: JComponent = NonOpaquePanel(BorderLayout())

    private val find = FindModel().apply {
        isCaseSensitive = false
        isWholeWordsOnly = false
        isRegularExpressions = false
        isMultiline = false
        isReplaceState = false
    }

    private var bar: SearchReplaceComponent? = null
    private var escape: Disposable? = null
    private var debounce: Job? = null
    private var content: Job? = null
    private var search: Job? = null
    @Volatile
    private var generation = 0L
    private var active = false
    private var disposed = false
    private var searching = false
    private var results: List<Hit> = emptyList()
    private var current = -1
    private var error: String? = null
    private var last = TranscriptMatchOptions("")
    private var restoreFocus: JComponent? = null
    private var pending = 0
    private var pendingIndex: Int? = null
    private var revealPending = false
    private var refreshPending = false
    private val watched = LinkedHashMap<MdView, MdSearchView.SearchListener>()
    private val cache = WeakHashMap<MdView, SurfaceCache>()
    private val listener = MdSearchView.SearchListener { if (active) schedule(false) }
    private val observer = FindModel.FindModelObserver { onModelChanged() }

    private class Hit(
        val body: TranscriptSearchBody,
        val surface: MdSearchView.SearchSurface,
        val range: TextRange,
    )

    private class SurfaceCache(val revision: Long, val list: List<MdSearchView.SearchSurface>)

    init {
        host.isVisible = false
        host.border = JBUI.Borders.empty()
        panel.onSearchInvalidated = { if (active) schedule(false) }
        find.addObserver(observer)
    }

    override fun getFindModel(): FindModel = find

    override fun getComponent(): SearchReplaceComponent = ensureBar()

    override fun hasMatches(): Boolean = results.isNotEmpty()

    override fun isSearchInProgress(): Boolean = searching

    @RequiresEdt
    fun open() {
        if (!active) {
            active = true
            restoreFocus = focusOwner()
            ensureBar()
            host.isVisible = true
            host.revalidate()
            host.repaint()
            scroll.component.revalidate()
            scroll.component.repaint()
            installEscape()
            val field = ensureBar().getSearchTextComponent()
            if (find.stringToFind.isNotEmpty() && field.text != find.stringToFind) field.text = find.stringToFind
            field.selectAll()
            IdeFocusManager.getInstance(project).requestFocus(field, true)
            if (find.stringToFind.isNotEmpty()) {
                schedule(true)
            } else {
                updateStatus()
            }
            return
        }
        ensureBar().getSearchTextComponent().selectAll()
        IdeFocusManager.getInstance(project).requestFocus(ensureBar().getSearchTextComponent(), true)
    }

    @RequiresEdt
    fun onShown() {
        if (!active) return
        schedule(false)
    }

    @RequiresEdt
    fun applyStyle() {
        if (!active) return
        if (results.any { it.surface.revision != it.body.md.searchRevision() }) {
            schedule(false)
            return
        }
        applyHighlights()
    }

    override fun searchForward() {
        if (!active) {
            pending = 1
            open()
            return
        }
        navigate(1)
    }

    override fun searchBackward() {
        if (!active) {
            pending = -1
            open()
            return
        }
        navigate(-1)
    }

    override fun close() {
        if (!active) return
        active = false
        generation++
        debounce?.cancel()
        content?.cancel()
        content = null
        search?.cancel()
        searching = false
        clearHighlights()
        for ((md, item) in watched) md.removeSearchListener(item)
        watched.clear()
        cache.clear()
        results = emptyList()
        current = -1
        error = null
        host.isVisible = false
        host.revalidate()
        host.repaint()
        scroll.component.revalidate()
        scroll.component.repaint()
        disposeEscape()
        bar?.let {
            it.setStatusText("")
            it.setRegularBackground()
            it.updateActions()
        }
        val target = restoreFocus?.takeIf { it.isShowing } ?: focusFallback()?.takeIf { it.isShowing }
        restoreFocus = null
        if (target != null) IdeFocusManager.getInstance(project).requestFocus(target, true)
    }

    private fun ensureBar(): SearchReplaceComponent {
        bar?.let { return it }
        val built = SearchReplaceComponent.buildFor(project, panel, this)
            .addPrimarySearchActions(StatusTextAction(), PrevOccurrenceAction(), NextOccurrenceAction())
            .addExtraSearchActions(ToggleMatchCase(), ToggleWholeWordsOnlyAction(), ToggleRegex())
            .withMultilineEnabled(false)
            .withNewLineButton(false)
            .withAddSearchResultsToGlobalSearch(false)
            .withCloseAction { close() }
            .build()
        built.addListener(object : SearchReplaceComponent.Listener {
            override fun searchFieldDocumentChanged() {
                val text = built.getSearchTextComponent().text
                if (find.stringToFind != text) find.stringToFind = text
            }
        })
        bar = built
        host.add(built, BorderLayout.CENTER)
        return built
    }

    private fun onModelChanged() {
        val next = TranscriptMatchOptions(
            query = find.stringToFind,
            caseSensitive = find.isCaseSensitive,
            wholeWords = find.isWholeWordsOnly,
            regex = find.isRegularExpressions,
        )
        if (next == last) return
        val reveal = next.query != last.query
        last = next
        if (reveal) {
            pending = 0
            pendingIndex = null
            revealPending = false
        }
        schedule(reveal)
    }

    private fun schedule(reveal: Boolean) {
        if (!active) return
        if (!reveal) {
            // Never cancel an in-flight search: a slow match on a long transcript must be allowed
            // to publish. Defer the refresh until it finishes instead of restarting the wait.
            if (search?.isActive == true) {
                refreshPending = true
                return
            }
            scheduleContent()
            return
        }
        content?.cancel()
        content = null
        refreshPending = false
        debounce?.cancel()
        debounce = scope.launch(Dispatchers.EDT) {
            delay(DEBOUNCE_QUERY_MS)
            start(true)
        }
    }

    private fun scheduleContent() {
        if (content?.isActive == true) return
        content = scope.launch(Dispatchers.EDT) {
            delay(DEBOUNCE_CONTENT_MS)
            start(false)
        }
    }

    @RequiresEdt
    private fun start(reveal: Boolean) {
        if (!active) return
        val options = TranscriptMatchOptions(
            query = find.stringToFind,
            caseSensitive = find.isCaseSensitive,
            wholeWords = find.isWholeWordsOnly,
            regex = find.isRegularExpressions,
        )
        if (options.query.isEmpty()) {
            generation++
            search?.cancel()
            searching = false
            clearHighlights()
            results = emptyList()
            current = -1
            error = null
            pendingIndex = null
            revealPending = false
            refreshPending = false
            updateStatus()
            return
        }
        val bodies = panel.searchBodies()
        watch(bodies)
        val snapshots = bodies.map { body -> body to surfaces(body.md) }
        val id = ++generation
        search?.cancel()
        searching = true
        error = null
        updateStatus()
        search = scope.launch {
            val outcome = withContext(Dispatchers.Default) {
                collect(id, snapshots, options)
            }
            withContext(Dispatchers.EDT) {
                if (!active || id != generation) return@withContext
                apply(outcome, reveal)
            }
            withContext(Dispatchers.EDT) {
                if (active && id == generation && refreshPending) {
                    refreshPending = false
                    scheduleContent()
                }
            }
        }
    }

    private fun surfaces(md: MdView): List<MdSearchView.SearchSurface> {
        val revision = md.searchRevision()
        val cached = cache[md]
        if (cached != null && cached.revision == revision) return cached.list
        return md.searchSurfaces().also { cache[md] = SurfaceCache(revision, it) }
    }

    private fun watch(bodies: List<TranscriptSearchBody>) {
        val next = bodies.map { it.md }.toSet()
        for ((md, item) in watched) {
            if (md !in next) md.removeSearchListener(item)
        }
        watched.keys.retainAll(next)
        cache.keys.retainAll(next)
        for (body in bodies) {
            if (!watched.containsKey(body.md)) {
                watched[body.md] = listener
                body.md.addSearchListener(listener)
            }
        }
    }

    private fun collect(
        id: Long,
        snapshots: List<Pair<TranscriptSearchBody, List<MdSearchView.SearchSurface>>>,
        options: TranscriptMatchOptions,
    ): Outcome {
        val deadline = System.nanoTime() + TranscriptMatcher.BUDGET_MS * NANOS_PER_MS
        val hits = ArrayList<Hit>()
        for ((body, surfaces) in snapshots) {
            for (surface in surfaces) {
                if (id != generation) return Outcome.Cancelled
                val result = TranscriptMatcher.matches(
                    surface.text,
                    options,
                    deadline,
                    cancelled = { id != generation },
                )
                when (result) {
                    is TranscriptMatchResult.Matches -> {
                        for (range in result.ranges) {
                            if (excluded(surface, range)) continue
                            hits.add(Hit(body, surface, range))
                        }
                    }
                    TranscriptMatchResult.Cancelled -> return Outcome.Cancelled
                    TranscriptMatchResult.InvalidRegex -> return Outcome.Error("session.search.invalid")
                    TranscriptMatchResult.TimedOut -> return Outcome.Error("session.search.timeout")
                    TranscriptMatchResult.Failed -> return Outcome.Error("session.search.failed")
                }
            }
        }
        return Outcome.Results(hits)
    }

    private fun excluded(surface: MdSearchView.SearchSurface, range: TextRange): Boolean =
        surface.excluded.any { range.startOffset < it.endOffset && it.startOffset < range.endOffset }

    @RequiresEdt
    private fun apply(outcome: Outcome, reveal: Boolean) {
        searching = false
        when (outcome) {
            Outcome.Cancelled -> return
            is Outcome.Error -> fail(outcome.key)
            is Outcome.Results -> applyResults(outcome.hits, reveal)
        }
    }

    @RequiresEdt
    private fun fail(key: String) {
        error = key
        results = emptyList()
        current = -1
        pending = 0
        pendingIndex = null
        revealPending = false
        refreshPending = false
        clearHighlights()
        updateStatus()
    }

    @RequiresEdt
    private fun applyResults(hits: List<Hit>, reveal: Boolean) {
        val stale = hits.any { it.surface.revision != it.body.md.searchRevision() }
        val show = reveal || revealPending
        val anchor = results.getOrNull(current)
        val anchorKey = anchor?.body?.key
        val anchorStart = anchor?.range?.startOffset
        results = hits
        error = null
        current = choose(show, anchorKey, anchorStart)
        applyHighlights()
        updateStatus()
        if (stale) {
            revealPending = revealPending || reveal
            schedule(false)
            return
        }
        pending = 0
        pendingIndex = null
        if (show && current >= 0) {
            reveal(results[current])
            revealPending = false
        }
    }

    private fun choose(show: Boolean, anchorKey: String?, anchorStart: Int?): Int {
        if (results.isEmpty()) return -1
        val jump = pendingIndex
        if (jump != null) return jump.coerceIn(0, results.lastIndex)
        if (pending < 0) return results.lastIndex
        if (pending > 0) return 0
        if (show) return firstVisible()
        if (anchorKey != null) return nearest(anchorKey, anchorStart ?: 0)
        return current.coerceIn(0, results.lastIndex)
    }

    private fun nearest(key: String, start: Int): Int {
        val same = results.withIndex().filter { it.value.body.key == key }
        if (same.isNotEmpty()) {
            return same.firstOrNull { it.value.range.startOffset >= start }?.index
                ?: same.last().index
        }
        return current.coerceIn(0, results.lastIndex)
    }

    private fun firstVisible(): Int {
        val viewport = scroll.component.viewport
        val top = viewport.viewPosition.y
        val bottom = top + viewport.extentSize.height
        for ((index, hit) in results.withIndex()) {
            val component = hit.body.md.component
            if (!component.isShowing) continue
            val point = runCatching { SwingUtilities.convertPoint(component, 0, 0, panel) }.getOrNull() ?: continue
            if (point.y + component.height >= top && point.y <= bottom) return index
        }
        return 0
    }

    @RequiresEdt
    private fun navigate(direction: Int) {
        if (!active) {
            open()
            return
        }
        if (find.stringToFind.isEmpty()) {
            ensureBar().getSearchTextComponent().requestFocusInWindow()
            return
        }
        if (results.isEmpty()) {
            pending = direction
            revealPending = true
            schedule(false)
            return
        }
        if (results.any { it.surface.revision != it.body.md.searchRevision() }) {
            pendingIndex = target(direction)
            pending = 0
            revealPending = true
            schedule(false)
            return
        }
        current = target(direction)
        applyHighlights()
        updateStatus()
        reveal(results[current])
    }

    private fun target(direction: Int): Int =
        if (current < 0) {
            if (direction > 0) 0 else results.lastIndex
        } else {
            Math.floorMod(current + direction, results.size)
        }

    @RequiresEdt
    private fun reveal(hit: Hit) {
        if (hit.surface.revision != hit.body.md.searchRevision()) {
            schedule(false)
            return
        }
        if (hit.body.collapsed()) hit.body.reveal()
        hit.body.md.scrollIntoView(hit.surface, hit.range)
        val component = hit.body.md.component
        val rect = hit.body.md.searchRect(hit.surface, hit.range)
        if (rect != null) {
            scroll.scrollToRect(component, rect)
            return
        }
        ApplicationManager.getApplication().invokeLater {
            if (!active || results.getOrNull(current) !== hit) return@invokeLater
            hit.body.md.scrollIntoView(hit.surface, hit.range)
            val retry = hit.body.md.searchRect(hit.surface, hit.range) ?: return@invokeLater
            scroll.scrollToRect(hit.body.md.component, retry)
        }
    }

    @RequiresEdt
    private fun applyHighlights() {
        val currentHit = results.getOrNull(current)
        val groups = LinkedHashMap<MdView, MutableMap<Int, MutableList<TextRange>>>()
        val known = HashMap<MdView, HashMap<Int, MdSearchView.SearchSurface>>()
        for (hit in results) {
            groups.getOrPut(hit.body.md) { LinkedHashMap() }
                .getOrPut(hit.surface.id) { mutableListOf() }
                .add(hit.range)
            known.getOrPut(hit.body.md) { HashMap() }[hit.surface.id] = hit.surface
        }
        for (md in watched.keys) {
            if (!groups.containsKey(md)) md.clearSearchHighlights()
        }
        for ((md, surfaces) in groups) {
            val map = LinkedHashMap<Int, MdSearchView.SearchHighlights>()
            for ((id, ranges) in surfaces) {
                val surface = known[md]?.get(id)
                val activeRange = currentHit?.takeIf { it.body.md === md && it.surface.id == id }?.range
                val shown = ranges.map { display(surface, it) }
                map[id] = MdSearchView.SearchHighlights(shown, activeRange?.let { display(surface, it) })
            }
            md.applySearchHighlights(map)
        }
    }

    private fun display(surface: MdSearchView.SearchSurface?, range: TextRange): TextRange {
        if (surface == null || range.length > 0 || surface.text.isEmpty()) return range
        val start = range.startOffset.coerceIn(0, surface.text.length - 1)
        return TextRange(start, start + 1)
    }

    @RequiresEdt
    private fun clearHighlights() {
        for (md in watched.keys) md.clearSearchHighlights()
    }

    @RequiresEdt
    private fun updateStatus() {
        val bar = bar ?: return
        when {
            find.stringToFind.isEmpty() -> {
                bar.setStatusText("")
                bar.setRegularBackground()
            }
            searching -> {
                bar.setStatusText(KiloBundle.message("session.search.searching"))
                bar.setRegularBackground()
            }
            error != null -> {
                bar.setStatusText(KiloBundle.message(error.orEmpty()))
                bar.setNotFoundBackground()
            }
            results.isEmpty() -> {
                bar.setStatusText(KiloBundle.message("session.search.none"))
                bar.setNotFoundBackground()
            }
            else -> {
                bar.setStatusText(KiloBundle.message("session.search.status", current + 1, results.size))
                bar.setRegularBackground()
            }
        }
        bar.updateActions()
    }

    private fun focusOwner(): JComponent? {
        val owner = IdeFocusManager.getInstance(project).focusOwner
        return owner as? JComponent
    }

    @Suppress("SpreadOperator")
    private fun installEscape() {
        disposeEscape()
        val disposable = Disposer.newDisposable("Kilo transcript search escape")
        val action = object : DumbAwareAction() {
            override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.EDT

            override fun actionPerformed(e: AnActionEvent) {
                close()
            }
        }
        val shortcuts = KeymapUtil.getActiveKeymapShortcuts(IdeActions.ACTION_EDITOR_ESCAPE)
        if (shortcuts.shortcuts.isEmpty()) {
            escape = disposable
            return
        }
        action.registerCustomShortcutSet(CustomShortcutSet(*shortcuts.shortcuts), owner, disposable)
        escape = disposable
    }

    private fun disposeEscape() {
        escape?.let { Disposer.dispose(it) }
        escape = null
    }

    override fun dispose() {
        if (disposed) return
        disposed = true
        active = false
        generation++
        debounce?.cancel()
        content?.cancel()
        search?.cancel()
        debounce = null
        content = null
        search = null
        panel.onSearchInvalidated = null
        find.removeObserver(observer)
        for ((md, item) in watched) md.removeSearchListener(item)
        clearHighlights()
        watched.clear()
        cache.clear()
        disposeEscape()
        results = emptyList()
        current = -1
        pendingIndex = null
        revealPending = false
        refreshPending = false
        bar = null
        host.removeAll()
    }

    private sealed interface Outcome {
        data class Results(val hits: List<Hit>) : Outcome
        data class Error(val key: String) : Outcome
        data object Cancelled : Outcome
    }
}
