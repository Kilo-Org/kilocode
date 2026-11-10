package ai.kilocode.client.ui.md

import com.intellij.openapi.util.TextRange
import java.awt.Rectangle
import javax.swing.JComponent

internal const val MAX_SEARCH_HIGHLIGHTS = 500

/**
 * Optional search surface contract for rendered prose.
 *
 * It is deliberately separate from [MdView] so the main renderer interface stays focused; only
 * renderers that expose conversation prose implement it. All methods are EDT-only.
 */
interface MdSearchView {
    /** Monotonically increasing when rendered searchable text or its documents change. */
    fun searchRevision(): Long = 0

    /** Rendered prose surfaces that transcript search may inspect. Each surface keeps document offsets. */
    fun searchSurfaces(): List<SearchSurface> = emptyList()

    /** Bounds of [range] in [SearchSurface.component] coordinates, or null while the surface is not laid out. */
    fun searchRect(surface: SearchSurface, range: TextRange): Rectangle? = null

    /** Scrolls a nested surface (for example a wide table) so [range] is visible inside it. */
    fun scrollIntoView(surface: SearchSurface, range: TextRange) = Unit

    /** Replace every search-owned highlight. Surfaces absent from [highlights] are cleared. */
    fun applySearchHighlights(highlights: Map<Int, SearchHighlights>) = Unit

    fun clearSearchHighlights() = Unit

    fun addSearchListener(listener: SearchListener) = Unit

    fun removeSearchListener(listener: SearchListener) = Unit

    data class SearchSurface(
        val id: Int,
        val component: JComponent,
        val text: String,
        val excluded: List<TextRange>,
        val revision: Long,
    )

    data class SearchHighlights(val ranges: List<TextRange>, val current: TextRange?)

    fun interface SearchListener {
        fun onSearchChanged()
    }
}
