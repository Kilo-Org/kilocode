package ai.kilocode.client.session.ui.model

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.ui.PickerButton
import ai.kilocode.client.ui.picker.PickerPopup
import ai.kilocode.client.ui.picker.popupBackground
import ai.kilocode.rpc.dto.ModelAutoRoutingDto
import ai.kilocode.rpc.dto.ModelCapabilitiesDto
import ai.kilocode.rpc.dto.ModelCostDto
import ai.kilocode.rpc.dto.ModelLimitDto
import ai.kilocode.rpc.dto.ModelOptionsDto
import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.ModelTerminalBenchDto
import com.intellij.ide.util.PropertiesComponent
import com.intellij.ui.CollectionListModel
import com.intellij.util.ui.JBUI
import com.intellij.xml.util.XmlStringUtil
import java.awt.Cursor
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.SwingConstants

private const val MODEL_PICKER_MIN_WIDTH = 420
private const val MODEL_PICKER_MAX_WIDTH = 760
private const val MODEL_PICKER_MAX_VISIBLE_ROWS = 10
private const val MODEL_PICKER_EMPTY_LIST_HEIGHT = 120

class ModelPicker : PickerButton() {

    data class Item(
        val id: String,
        val display: String,
        val provider: String,
        val providerName: String,
        val inputPrice: Double? = null,
        val outputPrice: Double? = null,
        val contextLength: Long? = null,
        val releaseDate: String? = null,
        val latest: Boolean? = null,
        val recommendedIndex: Double? = null,
        val free: Boolean = false,
        val byok: Boolean = false,
        val variants: List<String> = emptyList(),
        val limit: ModelLimitDto? = null,
        val cost: ModelCostDto? = null,
        val capabilities: ModelCapabilitiesDto? = null,
        val options: ModelOptionsDto? = null,
        val autoRouting: ModelAutoRoutingDto? = null,
        val terminalBench: ModelTerminalBenchDto? = null,
        val reasoning: Boolean = false,
        val attachment: Boolean = false,
        val mayTrainOnYourPrompts: Boolean = false,
    ) {
        val key: String get() = "$provider/$id"

        override fun toString(): String = listOf(display, id, providerName).joinToString(" ")
    }

    enum class Placement {
        ABOVE,
        BELOW,
    }

    var onSelect: (Item) -> Unit = {}
    var onClear: () -> Unit = {}
    var favorites: () -> List<ModelSelectionDto> = { emptyList() }
    var onFavoriteToggle: (Item) -> Unit = {}
    var allowEmpty: Boolean = false
    var emptyText: String = KiloBundle.message("settings.models.notSet")
    var includeSmall: Boolean = false
    var placement: Placement = Placement.BELOW

    private var items: List<Item> = emptyList()
    private var selected: Item? = null
    private val props get() = PropertiesComponent.getInstance()

    init {
        isEnabled = false
        text = " "
        toolTipText = KiloBundle.message("model.picker.tooltip")

        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (!isEnabled || (items.isEmpty() && !allowEmpty)) return
                showPopup()
            }
        })
    }

    fun setItems(values: List<Item>, default: String? = null) {
        items = values
        val key = default ?: selected?.key
        selected = key?.let { target -> values.firstOrNull { it.key == target || it.id == target } }
            ?: if (allowEmpty) null else values.firstOrNull()
        refresh()
    }

    fun select(key: String) {
        selected = items.firstOrNull { it.key == key || it.id == key }
        refresh()
    }

    internal fun selectedForTest(): Item? = selected

    fun clearSelection() {
        selected = null
        refresh()
    }

    fun selectionKeyForTest(): String? = selected?.key

    private fun refresh() {
        if (items.isEmpty()) {
            isEnabled = allowEmpty
            text = if (allowEmpty) emptyText else " "
            icon = null
            toolTipText = KiloBundle.message("model.picker.tooltip")
            cursor = if (allowEmpty) Cursor.getPredefinedCursor(Cursor.HAND_CURSOR) else Cursor.getDefaultCursor()
            return
        }
        val item = selected ?: if (allowEmpty) null else items.firstOrNull()
        text = if (item == null && allowEmpty) "$emptyText ▾" else "${ModelText.buttonLabel(item ?: items.first())} ▾"
        icon = if (item?.let(ModelText::collectsData) == true) ModelPickerRenderer.DATA_COLLECTED else null
        horizontalTextPosition = SwingConstants.LEFT
        iconTextGap = JBUI.CurrentTheme.ActionsList.elementIconGap()
        toolTipText = if (item?.let(ModelText::collectsData) == true) ModelText.dataCollectedTooltip() else KiloBundle.message("model.picker.tooltip")
        isEnabled = true
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
    }

    fun open() {
        if (!isEnabled || (items.isEmpty() && !allowEmpty)) return
        showPopup()
    }

    private fun showPopup() {
        val data = CollectionListModel(modelPickerRows(items, favorites(), "", allowEmpty, emptyText, includeSmall))
        var popup: PickerPopup<ModelPickerRow>? = null
        val renderer = ModelPickerRenderer(
            model = data,
            active = { selected?.key },
            favorites = { favoriteKeys() },
        )
        var refreshFavorite: (Item) -> Unit = {}
        val details = ModelDetailsPanel(
            favorites = { favoriteKeys() },
            toggle = { refreshFavorite(it) },
        ).apply {
            background = popupBackground
        }

        fun activate(item: Item) {
            selected = item
            refresh()
            onSelect(item)
        }

        fun clear() {
            selected = null
            refresh()
            onClear()
        }

        fun activate(row: ModelPickerRow) {
            val item = row.item
            if (item == null) {
                clear()
                return
            }
            activate(item)
        }

        fun toggle(row: ModelPickerRow) {
            val item = row.item ?: return
            onFavoriteToggle(item)
        }

        refreshFavorite = { item ->
            onFavoriteToggle(item)
            popup?.refresh(prefer = item.key)
            popup?.repaint()
        }

        popup = PickerPopup(
            anchor = this,
            placement = when (placement) {
                Placement.ABOVE -> PickerPopup.Placement.ABOVE
                Placement.BELOW -> PickerPopup.Placement.BELOW
            },
            rows = { q -> modelPickerRows(items, favorites(), q, allowEmpty, emptyText, includeSmall) },
            model = data,
            renderer = renderer,
            key = { it.key },
            mode = PickerPopup.Mode.Single,
            onPrimary = ::activate,
            sectionTitle = ::modelPickerSectionTitle,
            trailingHit = ModelPickerRenderer::isFavoriteClick,
            onTrailing = ::toggle,
            search = true,
            details = details,
            onPreview = { details.update(it?.item ?: selected) },
            expandStateKey = MODEL_PICKER_EXPANDED_KEY,
            minWidth = MODEL_PICKER_MIN_WIDTH,
            maxWidth = MODEL_PICKER_MAX_WIDTH,
            maxVisibleRows = MODEL_PICKER_MAX_VISIBLE_ROWS,
            emptyListHeight = MODEL_PICKER_EMPTY_LIST_HEIGHT,
        )
        popup.show()
    }

    private fun favoriteKeys(): Set<String> = favorites().mapTo(mutableSetOf()) { "${it.providerID}/${it.modelID}" }

    internal fun expandedForTest(): Boolean = props.getBoolean(MODEL_PICKER_EXPANDED_KEY, false)
}

internal const val MODEL_PICKER_EXPANDED_KEY = "kilo.model.picker.expanded"

internal data class ModelPickerRow(
    val item: ModelPicker.Item?,
    val section: String?,
    val favorite: Boolean,
    val emptyText: String = "",
) {
    val key: String? get() = item?.key
    val isEmpty: Boolean get() = item == null
}

internal object ModelSearch {
    fun matches(query: String, text: String): Boolean {
        val q = query.lowercase().trim()
        if (q.isEmpty()) return true
        val parts = words(q)
        if (parts.isEmpty()) return true
        return parts.all { acronym(text, it) }
    }

    fun acronym(text: String, query: String): Boolean {
        val words = words(text)
        fun attempt(wi: Int, qi: Int): Boolean {
            if (qi == query.length) return true
            if (wi >= words.size) return false
            val word = words[wi]
            var count = 0
            while (qi + count < query.length && count < word.length && word[count] == query[qi + count]) {
                count++
            }
            if (count > 0 && attempt(wi + 1, qi + count)) return true
            return attempt(wi + 1, qi)
        }
        return attempt(0, 0)
    }

    private fun words(text: String): List<String> {
        val out = mutableListOf<String>()
        val buf = StringBuilder()
        fun flush() {
            if (buf.isEmpty()) return
            out += buf.toString().lowercase()
            buf.clear()
        }
        for (ch in text) {
            if (ch in "[]_.: /\\(){}-") {
                flush()
                continue
            }
            if (ch.isUpperCase() && buf.isNotEmpty()) flush()
            buf.append(ch)
        }
        flush()
        return out
    }
}

internal object ModelText {
    private val small = setOf("kilo-auto/small", "auto-small")

    data class Parts(val provider: String?, val model: String)

    fun sanitize(text: String): String = text.replace(Regex("[\\s:_-]*\\(free\\)\\s*$", RegexOption.IGNORE_CASE), "").trim()

    fun parts(item: ModelPicker.Item): Parts {
        val text = sanitize(item.display)
        val colon = text.indexOf(':')
        if (colon > 0) {
            val prefix = text.substring(0, colon).trim()
            val model = text.substring(colon + 1).trim()
            if (prefix.isNotEmpty() && model.isNotEmpty()) return Parts(prefix, model)
        }
        val prefix = item.providerName.trim()
        if (prefix.isNotEmpty() && text.length > prefix.length && text.startsWith(prefix, ignoreCase = true) && text[prefix.length].isWhitespace()) {
            val model = text.substring(prefix.length).trim()
            if (model.isNotEmpty()) return Parts(text.substring(0, prefix.length), model)
        }
        return Parts(null, text)
    }

    fun buttonLabel(item: ModelPicker.Item): String {
        val part = parts(item).model
        if (item.provider == "kilo") return part
        val provider = item.providerName.trim()
        if (provider.isEmpty()) return part
        return "$provider / $part"
    }

    fun small(item: ModelPicker.Item): Boolean = item.provider == "kilo" && item.id in small

    fun providerSort(id: String): Int = if (id == "kilo") 0 else 1

    fun dataCollected(): String = KiloBundle.message("model.picker.dataCollected")

    fun dataCollectedTooltip(): String = XmlStringUtil.wrapInHtmlLines(
        KiloBundle.message("model.picker.tooltip"),
        KiloBundle.message("model.picker.dataCollected.current"),
    )

    fun freeLabel(): String = KiloBundle.message("model.picker.free")

    fun collectsData(item: ModelPicker.Item): Boolean = item.mayTrainOnYourPrompts

}
