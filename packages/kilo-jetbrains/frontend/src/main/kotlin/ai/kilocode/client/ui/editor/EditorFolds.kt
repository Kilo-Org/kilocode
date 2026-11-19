package ai.kilocode.client.ui.editor

import com.intellij.openapi.editor.FoldRegion
import com.intellij.openapi.editor.RangeMarker
import com.intellij.openapi.editor.ex.EditorEx
import com.intellij.openapi.editor.ex.FoldingListener
import com.intellij.openapi.editor.ex.util.EditorUtil
import com.intellij.openapi.util.Disposer
import com.intellij.util.concurrency.annotations.RequiresEdt

/**
 * Renders chosen document ranges as collapsed fold placeholders that the reader can unfold by
 * clicking, and fold again from the gutter handle.
 *
 * Shared by the prompt input and the transcript so both give the same interaction. The gutter fold
 * outline is shown only while a fold is tracked, because an editor with every other gutter area
 * turned off would otherwise reserve empty width for a control with nothing to fold.
 *
 * @param live the editor currently owned by the host, or null while it is between editors
 * @param resize invoked after the fold state changes, so the host can re-measure its height
 */
class EditorFolds(
    private val live: () -> EditorEx?,
    private val resize: () -> Unit = {},
) {

    private val folds = mutableListOf<Fold>()
    private var quiet = false

    /** Tracks [from]..[to] as a fold labelled [placeholder] and collapses it on [ed]. */
    @RequiresEdt
    fun fold(ed: EditorEx, from: Int, to: Int, placeholder: String) {
        folds += Fold(ed.document.createRangeMarker(from, to), placeholder)
        restore(ed)
    }

    /**
     * Restores tracked folds on [ed] and keeps them in sync with its folding model. Call from the
     * host's editor settings provider so folds come back when the editor is recreated.
     */
    @RequiresEdt
    fun install(ed: EditorEx) {
        val parent = Disposer.newDisposable("kilo-editor-folds")
        EditorUtil.disposeWithEditor(ed, parent)
        ed.foldingModel.addListener(object : FoldingListener {
            private var changed = false

            // The folding model may report inconsistent data until processing ends, so only note
            // that something moved here and act on it in onFoldProcessingEnd().
            override fun onFoldRegionStateChange(region: FoldRegion) {
                changed = true
            }

            override fun onFoldProcessingEnd() {
                if (!changed) return
                changed = false
                // Only react while this editor is the host's live one. A field clears it both
                // before creating an editor (settings providers run there, and resizing would
                // re-enter that creation) and before releasing one, whose regions disappear
                // without the folds themselves going away.
                if (live() !== ed) return
                if (quiet) return
                folds.filter(::stale).forEach(::drop)
                folds.forEach { item ->
                    val region = ed.foldingModel.getFoldRegion(item.marker.startOffset, item.marker.endOffset)
                    if (region != null) item.collapsed = !region.isExpanded
                }
                gutter(ed)
                resize()
            }
        }, parent)
        restore(ed)
    }

    /**
     * Runs [block] without recording the fold movement it causes as reader intent.
     *
     * Editing the document can expand a collapsed region on its own. Left unguarded that reads as
     * the reader unfolding the block, and [restore] would then honour it instead of folding back.
     */
    @RequiresEdt
    fun quiet(block: () -> Unit) {
        quiet = true
        try {
            block()
        } finally {
            quiet = false
        }
    }

    /** Drops folds whose text is gone and hides the gutter with them. Call on document changes. */
    @RequiresEdt
    fun sync() {
        if (folds.isEmpty()) return
        folds.filter(::stale).forEach(::drop)
        live()?.let(::gutter)
    }

    /** Stops tracking every fold and takes the gutter down. */
    @RequiresEdt
    fun clear() {
        folds.forEach { it.marker.dispose() }
        folds.clear()
        live()?.let(::gutter)
    }

    @RequiresEdt
    private fun restore(ed: EditorEx) {
        folds.filter(::stale).forEach(::drop)
        if (folds.isNotEmpty()) {
            ed.foldingModel.runBatchFoldingOperation {
                folds.toList().forEach { item ->
                    val from = item.marker.startOffset
                    val to = item.marker.endOffset
                    val current = ed.foldingModel.getFoldRegion(from, to)
                        ?: ed.foldingModel.addFoldRegion(from, to, item.placeholder)
                    if (current == null) {
                        drop(item)
                        return@forEach
                    }
                    // A fold that fits on one line gets no gutter handle by default, which would
                    // leave no way to fold it back once unfolded.
                    current.isGutterMarkEnabledForSingleLine = true
                    // Re-assert rather than only setting newly created regions: a document change
                    // can expand a region behind our back, and the fold should come back as the
                    // reader left it.
                    if (current.isExpanded == item.collapsed) current.setExpanded(!item.collapsed)
                }
            }
        }
        gutter(ed)
    }

    @RequiresEdt
    private fun gutter(ed: EditorEx) {
        val show = folds.isNotEmpty()
        if (ed.settings.isFoldingOutlineShown == show) return
        ed.settings.isFoldingOutlineShown = show
        ed.gutterComponentEx.revalidateMarkup()
        ed.gutterComponentEx.revalidate()
        ed.gutterComponentEx.repaint()
    }

    /** Whether [item] no longer covers any text, so there is nothing left to fold. */
    private fun stale(item: Fold) =
        !item.marker.isValid || item.marker.startOffset >= item.marker.endOffset

    @RequiresEdt
    private fun drop(item: Fold) {
        folds.remove(item)
        item.marker.dispose()
    }

    /**
     * A folded range.
     *
     * [marker] is document-scoped so the range survives the host releasing its editor, while
     * [collapsed] carries the fold state across the same gap — that lives only on the per-editor
     * `FoldRegion`, so without it a block the reader unfolded would come back folded.
     */
    private class Fold(val marker: RangeMarker, val placeholder: String, var collapsed: Boolean = true)
}
