package ai.kilocode.client.session.ui.model

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.picker.PickerPopup
import ai.kilocode.client.ui.picker.popupBackground
import ai.kilocode.rpc.dto.ModelSelectionDto
import com.intellij.openapi.ui.popup.JBPopup
import com.intellij.ui.CollectionListModel
import com.intellij.ui.awt.RelativePoint
import javax.swing.JComponent

private const val MIN_WIDTH = 420
private const val MAX_WIDTH = 760
private const val MAX_VISIBLE_ROWS = 10
private const val EMPTY_LIST_HEIGHT = 120

/**
 * The shared model dropdown: favorite and recommended sections, search, the details pane and the
 * favorite toggle. [ModelPicker] opens it from its button; a settings list opens the same dropdown
 * from an in-place row cell, which has no live component and so anchors at [at].
 */
internal class ModelPopup(
    private val anchor: JComponent,
    private val items: () -> List<ModelPicker.Item>,
    private val selected: () -> String?,
    private val onSelect: (ModelPicker.Item) -> Unit,
    private val onClear: () -> Unit = {},
    private val favorites: () -> List<ModelSelectionDto> = { emptyList() },
    private val onFavoriteToggle: (ModelPicker.Item) -> Unit = {},
    private val placement: PickerPopup.Placement = PickerPopup.Placement.BELOW,
    private val at: RelativePoint? = null,
    private val allowEmpty: Boolean = false,
    private val emptyText: String = KiloBundle.message("settings.models.notSet"),
    private val includeSmall: Boolean = false,
) {
    private var cache: Pair<String?, String?> = null to null

    fun show(): JBPopup {
        val data = CollectionListModel(rows(""))
        var popup: PickerPopup<ModelPickerRow>? = null
        var toggle: (ModelPicker.Item) -> Unit = {}
        val details = ModelDetailsPanel(favorites = ::keys, toggle = { toggle(it) }).apply {
            background = popupBackground
        }

        fun pick(row: ModelPickerRow) {
            val item = row.item
            if (item == null) {
                onClear()
                return
            }
            onSelect(item)
        }

        toggle = { item ->
            onFavoriteToggle(item)
            popup?.refresh(prefer = item.key)
            popup?.repaint()
        }

        popup = PickerPopup(
            anchor = anchor,
            placement = placement,
            at = at,
            rows = ::rows,
            model = data,
            renderer = ModelPickerRenderer(model = data, active = ::active, favorites = ::keys),
            key = { it.key },
            mode = PickerPopup.Mode.Single,
            onPrimary = ::pick,
            sectionTitle = ::modelPickerSectionTitle,
            trailingHit = ModelPickerRenderer::isFavoriteClick,
            onTrailing = { row -> row.item?.let(onFavoriteToggle) },
            search = true,
            details = details,
            onPreview = { details.update(it?.item ?: current()) },
            expandStateKey = MODEL_PICKER_EXPANDED_KEY,
            minWidth = MIN_WIDTH,
            maxWidth = MAX_WIDTH,
            maxVisibleRows = MAX_VISIBLE_ROWS,
            emptyListHeight = EMPTY_LIST_HEIGHT,
        )
        return popup.show()
    }

    private fun rows(query: String) = modelPickerRows(items(), favorites(), query, allowEmpty, emptyText, includeSmall)

    /**
     * The checkmark compares [ModelPickerRow.key], so a stored `provider/id` and a bare model id have
     * to resolve to the same row. Memoized per distinct value because the renderer asks for every row
     * on every width pass, which happens on each search keystroke.
     */
    private fun active(): String? {
        val value = selected()
        if (cache.first != value) cache = value to item(value)?.key
        return cache.second
    }

    internal fun activeForTest(): String? = active()

    private fun current(): ModelPicker.Item? = item(selected())

    private fun item(value: String?): ModelPicker.Item? {
        if (value == null) return null
        return items().firstOrNull { it.key == value || it.id == value }
    }

    private fun keys(): Set<String> = favorites().mapTo(mutableSetOf()) { "${it.providerID}/${it.modelID}" }
}
