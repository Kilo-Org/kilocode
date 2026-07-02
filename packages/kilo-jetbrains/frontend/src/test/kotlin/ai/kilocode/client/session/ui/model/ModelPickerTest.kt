package ai.kilocode.client.session.ui.model

import ai.kilocode.rpc.dto.ModelSelectionDto
import ai.kilocode.rpc.dto.ModelAutoRoutingDto
import ai.kilocode.rpc.dto.ModelCacheCostDto
import ai.kilocode.rpc.dto.ModelCapabilitiesDto
import ai.kilocode.rpc.dto.ModelCostDto
import ai.kilocode.rpc.dto.ModelInputCapabilitiesDto
import ai.kilocode.rpc.dto.ModelLimitDto
import ai.kilocode.rpc.dto.ModelOptionsDto
import ai.kilocode.rpc.dto.ModelTerminalBenchDto
import com.intellij.icons.AllIcons
import com.intellij.ide.util.PropertiesComponent
import com.intellij.ui.CollectionListModel
import com.intellij.ui.NewUI
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBHtmlPane
import com.intellij.ui.components.JBList
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.JBUI
import java.awt.Component
import java.awt.ComponentOrientation
import java.awt.Container
import java.awt.Point
import java.awt.Rectangle

@Suppress("UnstableApiUsage")
class ModelPickerTest : BasePlatformTestCase() {

    fun `test smart filter matches split version text`() {
        assertTrue(ModelSearch.matches("gpt 54", "Chat GPT 5.4"))
    }

    fun `test smart filter matches delimited version text`() {
        assertTrue(ModelSearch.matches("gpt5", "gpt-5"))
    }

    fun `test smart filter matches word acronym`() {
        assertTrue(ModelSearch.matches("clso", "Claude Sonnet"))
    }

    fun `test section order starts with favorites and recommended`() {
        val rows = modelPickerRows(listOf(
            item("gpt-4o", "GPT 4o", "openai", "OpenAI"),
            item("claude", "Claude Sonnet", "anthropic", "Anthropic", 1.0),
            item("auto", "Kilo Auto", "kilo", "Kilo", 0.0),
        ), listOf(ModelSelectionDto("openai", "gpt-4o")), "")

        assertEquals("Favorites", modelPickerSectionTitle(rows, 0))
        assertEquals("openai/gpt-4o", rows[0].key)
        assertEquals("Recommended", modelPickerSectionTitle(rows, 1))
        assertEquals("kilo/auto", rows[1].key)
        assertEquals("anthropic/claude", rows[2].key)
    }

    fun `test favorites are hidden while filtering`() {
        val rows = modelPickerRows(listOf(
            item("gpt-4o", "GPT 4o", "openai", "OpenAI"),
            item("claude", "Claude Sonnet", "anthropic", "Anthropic"),
        ), listOf(ModelSelectionDto("openai", "gpt-4o")), "gpt")


        assertFalse(rows.indices.any { modelPickerSectionTitle(rows, it) == "Favorites" })
        assertEquals("openai/gpt-4o", rows.single().key)
    }

    fun `test favorites match provider qualified key when model ids collide`() {
        val rows = modelPickerRows(listOf(
            item("gpt", "OpenAI GPT", "openai", "OpenAI"),
            item("gpt", "Azure GPT", "azure", "Azure"),
        ), listOf(ModelSelectionDto("azure", "gpt")), "")

        assertEquals("azure/gpt", rows[0].key)
        assertEquals("Favorites", modelPickerSectionTitle(rows, 0))
    }

    fun `test favorites preserve order and skip unavailable models`() {
        val rows = modelPickerRows(listOf(
            item("a", "A", "openai", "OpenAI"),
            item("b", "B", "openai", "OpenAI"),
        ), listOf(
            ModelSelectionDto("openai", "b"),
            ModelSelectionDto("missing", "model"),
            ModelSelectionDto("openai", "a"),
        ), "")

        assertEquals(listOf("openai/b", "openai/a"), rows.take(2).map { it.key })
        assertTrue(rows.take(2).all { it.favorite })
    }

    fun `test filter matches model id and provider name`() {
        val rows = modelPickerRows(listOf(
            item("claude-sonnet", "Sonnet", "anthropic", "Anthropic"),
            item("gpt", "GPT", "openai", "OpenAI"),
        ), emptyList(), "anth")

        assertEquals(listOf("anthropic/claude-sonnet"), rows.map { it.key })
    }

    fun `test kilo provider group is first and other providers keep source order`() {
        val rows = modelPickerRows(listOf(
            item("gpt", "GPT", "openai", "OpenAI"),
            item("auto", "Auto", "kilo", "Kilo"),
            item("claude", "Claude", "anthropic", "Anthropic"),
        ), emptyList(), "")

        assertEquals(listOf("Kilo", "OpenAI", "Anthropic"), rows.indices.mapNotNull { modelPickerSectionTitle(rows, it) })
    }

    fun `test index prefers favorite row over normal duplicate`() {
        val rows = listOf(
            ModelPickerRow(item("a", "A", "openai", "OpenAI"), "Favorites", true),
            ModelPickerRow(item("a", "A", "openai", "OpenAI"), "OpenAI", false),
        )

        assertEquals(0, modelPickerIndex(rows, "openai/a"))
    }

    fun `test index keeps same row after favorite insertion`() {
        val rows = modelPickerRows(listOf(
            item("a", "A", "openai", "OpenAI"),
            item("b", "B", "openai", "OpenAI"),
        ), listOf(ModelSelectionDto("openai", "b")), "")

        assertEquals(1, modelPickerIndex(rows, 1))
        assertEquals("openai/a", rows[modelPickerIndex(rows, 1)].key)
    }

    fun `test index caps after favorite removal`() {
        val rows = modelPickerRows(listOf(
            item("a", "A", "openai", "OpenAI"),
        ), emptyList(), "")

        assertEquals(0, modelPickerIndex(rows, 1))
        assertEquals(-1, modelPickerIndex(emptyList(), 1))
    }

    fun `test allowEmpty inserts not set row`() {
        val rows = modelPickerRows(
            listOf(item("a", "A", "openai", "OpenAI")),
            emptyList(),
            "",
            allowEmpty = true,
            emptyText = "Not set",
        )

        assertTrue(rows.first().isEmpty)
        assertEquals("Not set", rows.first().emptyText)
        assertEquals(0, modelPickerIndex(rows, null))
    }

    fun `test allowEmpty filters not set row`() {
        val rows = modelPickerRows(
            listOf(item("a", "A", "openai", "OpenAI")),
            emptyList(),
            "not",
            allowEmpty = true,
            emptyText = "Not set",
        )
        val missing = modelPickerRows(
            listOf(item("a", "A", "openai", "OpenAI")),
            emptyList(),
            "openai",
            allowEmpty = true,
            emptyText = "Not set",
        )

        assertTrue(rows.first().isEmpty)
        assertFalse(missing.any { it.isEmpty })
    }

    fun `test favorites only apply to real rows`() {
        val rows = modelPickerRows(
            listOf(item("a", "A", "openai", "OpenAI")),
            listOf(ModelSelectionDto("openai", "a")),
            "",
            allowEmpty = true,
            emptyText = "Not set",
        )

        assertFalse(rows.first().favorite)
        assertTrue(rows.drop(1).any { it.favorite })
    }

    fun `test small rows are included only when requested`() {
        val items = listOf(
            item("auto-small", "Small", "kilo", "Kilo"),
            item("auto", "Auto", "kilo", "Kilo"),
        )

        val default = modelPickerRows(items, emptyList(), "")
        val small = modelPickerRows(items, emptyList(), "", includeSmall = true)

        assertEquals(listOf("kilo/auto"), default.mapNotNull { it.key })
        assertEquals(listOf("kilo/auto", "kilo/auto-small"), small.mapNotNull { it.key }.sorted())
    }

    fun `test setItems preserves selected model when refreshed without default`() {
        val picker = ModelPicker()
        val rows = listOf(
            item("a", "A", "openai", "OpenAI"),
            item("b", "B", "openai", "OpenAI"),
        )

        picker.setItems(rows, "openai/b")
        picker.setItems(rows)

        assertEquals("openai/b", picker.selectedForTest()?.key)
    }

    fun `test setItems auto-selects first item by default`() {
        val picker = ModelPicker()

        picker.setItems(listOf(item("a", "A", "openai", "OpenAI")))

        assertEquals("openai/a", picker.selectionKeyForTest())
        assertEquals("OpenAI / A ▾", picker.text)
    }

    fun `test non-kilo selected model uses provider prefix`() {
        val picker = ModelPicker()

        picker.setItems(listOf(item("gpt-55", "GPT-5.5", "openai", "OpenAI")))

        assertEquals("OpenAI / GPT-5.5 ▾", picker.text)
    }

    fun `test non-kilo selected model strips duplicate provider prefix`() {
        val picker = ModelPicker()

        picker.setItems(listOf(item("gpt-55", "OpenAI GPT-5.5", "openai", "OpenAI")))

        assertEquals("OpenAI / GPT-5.5 ▾", picker.text)
    }

    fun `test non-kilo selected model strips vscode provider prefix`() {
        val picker = ModelPicker()

        picker.setItems(listOf(item("gpt-55", "OpenAI: GPT-5.5", "openai", "OpenAI")))

        assertEquals("OpenAI / GPT-5.5 ▾", picker.text)
    }

    fun `test kilo selected model remains unprefixed`() {
        val picker = ModelPicker()

        picker.setItems(listOf(item("auto", "Kilo Auto", "kilo", "Kilo")))

        assertEquals("Auto ▾", picker.text)
    }

    fun `test allowEmpty keeps empty selection`() {
        val picker = ModelPicker()
        picker.allowEmpty = true
        picker.emptyText = "Not set"

        picker.setItems(listOf(item("a", "A", "openai", "OpenAI")))

        assertNull(picker.selectionKeyForTest())
        assertEquals("Not set ▾", picker.text)
    }

    fun `test provider qualified default selects duplicate model id from correct provider`() {
        val picker = ModelPicker()

        picker.setItems(listOf(
            item("gpt", "OpenAI GPT", "openai", "OpenAI"),
            item("gpt", "Azure GPT", "azure", "Azure"),
        ), "azure/gpt")

        assertEquals("azure/gpt", picker.selectedForTest()?.key)
    }

    fun `test item keeps reasoning variants`() {
        val item = ModelPicker.Item("gpt", "GPT", "openai", "OpenAI", variants = listOf("low", "high"))

        assertEquals(listOf("low", "high"), item.variants)
    }

    fun `test expanded property defaults to collapsed`() {
        val props = PropertiesComponent.getInstance()
        props.unsetValue(MODEL_PICKER_EXPANDED_KEY)

        val picker = ModelPicker()

        assertFalse(picker.expandedForTest())
        props.setValue(MODEL_PICKER_EXPANDED_KEY, "true")
        assertTrue(picker.expandedForTest())
    }

    fun `test details panel displays preview metadata and updates favorite star`() {
        val fav = mutableSetOf<String>()
        val panel = ModelDetailsPanel(
            favorites = { fav },
            toggle = { fav += it.key },
        )
        val item = ModelPicker.Item(
            id = "auto",
            display = "Kilo Auto",
            provider = "kilo",
            providerName = "Kilo",
            releaseDate = "2026-06-01",
            latest = true,
            free = false,
            byok = true,
            limit = ModelLimitDto(context = 256000, input = 128000, output = 16000),
            cost = ModelCostDto(0.25, 1.5, ModelCacheCostDto(0.05, 0.2)),
            capabilities = ModelCapabilitiesDto(
                reasoning = true,
                input = ModelInputCapabilitiesDto(text = true, image = true, pdf = true),
            ),
            options = ModelOptionsDto("Fast routed model https://kilocode.ai"),
            autoRouting = ModelAutoRoutingDto(listOf("openai/gpt", "anthropic/claude")),
            terminalBench = ModelTerminalBenchDto(0.73, 1.25),
        )

        panel.update(item)

        assertTrue(panel.labels().any { it.contains("Auto") })
        assertTrue(panel.labels().any { it.contains("BYOK") })
        assertTrue(panel.labels().any { it.contains("Terminal Bench") })
        assertTrue(panel.labels().any { it.contains("73.0%") })
        assertTrue(panel.html().any { it.contains("Fast routed model") })
        assertTrue(panel.html().any { it.contains("href=\"https://kilocode.ai\"") })
        assertTrue(panel.labels().any { it.contains("openai/gpt") })
    }

    fun `test details panel shows free cached reads`() {
        val panel = ModelDetailsPanel(
            favorites = { emptySet() },
            toggle = {},
        )

        panel.update(ModelPicker.Item(
            id = "paid",
            display = "Paid",
            provider = "kilo",
            providerName = "Kilo",
            cost = ModelCostDto(1.0, 2.0, ModelCacheCostDto(0.0, 0.5)),
        ))

        assertTrue(panel.labels().any { it == "Free" })
        assertFalse(panel.labels().any { it == "Not supported" })
    }

    fun `test details panel updates retained description component`() {
        val panel = ModelDetailsPanel(
            favorites = { emptySet() },
            toggle = {},
        )
        val item = ModelPicker.Item(
            id = "first",
            display = "First",
            provider = "kilo",
            providerName = "Kilo",
            cost = ModelCostDto(1.0, 2.0, ModelCacheCostDto(0.1, 0.5)),
            options = ModelOptionsDto("First https://kilocode.ai"),
        )

        panel.update(item)
        val count = panel.treeSize()
        val html = panel.htmlPanes().single()
        panel.update(item.copy(id = "second", display = "Second", options = ModelOptionsDto("Second https://kilocode.ai/docs")))

        assertEquals(count, panel.treeSize())
        assertSame(html, panel.htmlPanes().single())
        assertTrue(panel.labels().any { it.contains("Second") })
        assertTrue(panel.html().any { it.contains("Second") })
        assertFalse(panel.html().any { it.contains("First") })
    }

    fun `test selected paid model with training flag indicates data collection`() {
        val picker = ModelPicker()

        picker.setItems(listOf(item("paid", "Paid", "kilo", "Kilo", training = true)))

        assertFalse(picker.text.contains("Data may be used for training"))
        assertSame(ModelPickerRenderer.DATA_COLLECTED, picker.icon)
        assertEquals("<html><nobr>Select model</nobr><br><nobr>The current selected model may be used for training</nobr></html>", picker.toolTipText)
    }

    fun `test selected free model without training flag does not indicate data collection`() {
        val picker = ModelPicker()

        picker.setItems(listOf(item("free", "Free", "kilo", "Kilo", free = true)))

        assertNull(picker.icon)
        assertEquals("Select model", picker.toolTipText)
    }

    fun `test display parts split provider prefix`() {
        val parts = ModelText.parts(item("claude-opus", "Anthropic Claude Opus 4.7", "anthropic", "Anthropic"))

        assertEquals("Anthropic", parts.provider)
        assertEquals("Claude Opus 4.7", parts.model)
    }

    fun `test display parts split vscode colon form`() {
        val parts = ModelText.parts(item("claude-opus", "Anthropic: Claude Opus 4.7", "anthropic", "Anthropic"))

        assertEquals("Anthropic", parts.provider)
        assertEquals("Claude Opus 4.7", parts.model)
    }

    fun `test display parts trim colon segments`() {
        val parts = ModelText.parts(item("laguna", " Poolside : Laguna M.1 ", "poolside", "Poolside"))

        assertEquals("Poolside", parts.provider)
        assertEquals("Laguna M.1", parts.model)
    }

    fun `test display parts keep plain model name`() {
        val parts = ModelText.parts(item("claude-sonnet", "Claude Sonnet 4.6", "anthropic", "Anthropic"))

        assertNull(parts.provider)
        assertEquals("Claude Sonnet 4.6", parts.model)
    }

    fun `test display parts sanitize free suffix`() {
        val parts = ModelText.parts(item("auto", "Auto Free (free)", "kilo", "Kilo"))

        assertNull(parts.provider)
        assertEquals("Auto Free", parts.model)
    }

    fun `test renderer shows empty favorite star only for selected row`() {
        val row = ModelPickerRow(item("auto", "Auto", "kilo", "Kilo"), "Kilo", false)
        val model = CollectionListModel(listOf(row))
        val renderer = ModelPickerRenderer(model, { null }, { emptySet() })
        val list = JBList(model)

        renderer.getListCellRendererComponent(list, row, 0, false, false)
        assertSame(EmptyIcon.ICON_16, renderer.starIcon())

        renderer.getListCellRendererComponent(list, row, 0, true, false)
        assertSame(AllIcons.Nodes.NotFavoriteOnHover, renderer.starIcon())
    }

    fun `test renderer keeps favorite star visible`() {
        val row = ModelPickerRow(item("auto", "Auto", "kilo", "Kilo"), "Kilo", false)
        val model = CollectionListModel(listOf(row))
        val renderer = ModelPickerRenderer(model, { null }, { setOf("kilo/auto") })
        val list = JBList(model)

        renderer.getListCellRendererComponent(list, row, 0, false, false)

        assertSame(AllIcons.Nodes.Favorite, renderer.starIcon())
    }

    fun `test renderer updates favorite star after favorites change`() {
        val row = ModelPickerRow(item("auto", "Auto", "kilo", "Kilo"), "Kilo", false)
        val model = CollectionListModel(listOf(row))
        val fav = mutableSetOf<String>()
        val renderer = ModelPickerRenderer(model, { null }, { fav })
        val list = JBList(model)

        renderer.getListCellRendererComponent(list, row, 0, false, false)
        assertSame(EmptyIcon.ICON_16, renderer.starIcon())

        fav += "kilo/auto"
        renderer.getListCellRendererComponent(list, row, 0, false, false)
        assertSame(AllIcons.Nodes.Favorite, renderer.starIcon())
    }

    fun `test favorite click area uses trailing edge in both orientations`() {
        val list = JBList(listOf<ModelPickerRow>())
        val bounds = Rectangle(10, 0, 100, 20)
        val inset = favoriteInset(list)

        assertTrue(ModelPickerRenderer.isFavoriteClick(list, bounds, Point(100 - inset, 10)))
        assertFalse(ModelPickerRenderer.isFavoriteClick(list, bounds, Point(20, 10)))

        list.componentOrientation = ComponentOrientation.RIGHT_TO_LEFT
        val rtl = favoriteInset(list)
        assertTrue(ModelPickerRenderer.isFavoriteClick(list, bounds, Point(20 + rtl, 10)))
        assertFalse(ModelPickerRenderer.isFavoriteClick(list, bounds, Point(100, 10)))
    }

    fun `test favorite click area ignores popup selection inset outside row content`() {
        val list = JBList(listOf<ModelPickerRow>())
        val bounds = Rectangle(10, 0, 100, 20)
        val inset = favoriteInset(list)

        if (inset <= 0) return

        assertFalse(ModelPickerRenderer.isFavoriteClick(list, bounds, Point(bounds.x + bounds.width - 1, 10)))
        assertTrue(ModelPickerRenderer.isFavoriteClick(list, bounds, Point(bounds.x + bounds.width - inset, 10)))
    }

    fun `test renderer shows free badge for free model`() {
        val row = ModelPickerRow(ModelPicker.Item("auto", "Auto", "kilo", "Kilo", free = true), "Kilo", false)
        val model = CollectionListModel(listOf(row))
        val renderer = ModelPickerRenderer(model, { null }, { emptySet() })
        val list = JBList(model)

        renderer.getListCellRendererComponent(list, row, 0, false, false)

        assertTrue(renderer.badgeVisible())
        assertEquals("Free", renderer.badgeText())
        assertFalse(renderer.warningVisible())
    }

    fun `test renderer shows data collection warning for paid training model`() {
        val row = ModelPickerRow(item("paid", "Paid", "kilo", "Kilo", training = true), "Kilo", false)
        val model = CollectionListModel(listOf(row))
        val renderer = ModelPickerRenderer(model, { null }, { emptySet() })
        val list = JBList(model)

        renderer.getListCellRendererComponent(list, row, 0, false, false)

        assertFalse(renderer.badgeVisible())
        assertTrue(renderer.warningVisible())
        assertEquals("Data may be used for training", renderer.warningTooltip())
    }

    fun `test renderer shows BYOK instead of free when both are available`() {
        val row = ModelPickerRow(
            ModelPicker.Item("claude", "Claude", "kilo", "Kilo", free = true, byok = true),
            "Kilo",
            false,
        )
        val model = CollectionListModel(listOf(row))
        val renderer = ModelPickerRenderer(model, { null }, { emptySet() })
        val list = JBList(model)

        renderer.getListCellRendererComponent(list, row, 0, false, false)

        assertTrue(renderer.byokVisible())
        assertFalse(renderer.badgeVisible())
    }

    fun `test renderer hides data collection warning without training flag`() {
        val row = ModelPickerRow(ModelPicker.Item("free", "Free", "openrouter", "OpenRouter", free = true), "OpenRouter", false)
        val model = CollectionListModel(listOf(row))
        val renderer = ModelPickerRenderer(model, { null }, { emptySet() })
        val list = JBList(model)

        renderer.getListCellRendererComponent(list, row, 0, false, false)

        assertTrue(renderer.badgeVisible())
        assertEquals("Free", renderer.badgeText())
        assertFalse(renderer.warningVisible())
    }

    fun `test renderer hides favorite and free affordances for empty row`() {
        val row = ModelPickerRow(null, null, false, "Not set")
        val model = CollectionListModel(listOf(row))
        val renderer = ModelPickerRenderer(model, { null }, { setOf("kilo/auto") })
        val list = JBList(model)

        renderer.getListCellRendererComponent(list, row, 0, true, false)

        assertSame(EmptyIcon.ICON_16, renderer.starIcon())
        assertFalse(renderer.badgeVisible())
        assertFalse(renderer.byokVisible())
    }

    private fun item(
        id: String,
        display: String,
        provider: String,
        name: String,
        index: Double? = null,
        free: Boolean = false,
        training: Boolean = false,
    ) = ModelPicker.Item(id, display, provider, name, recommendedIndex = index, free = free, mayTrainOnYourPrompts = training)

    private fun favoriteInset(list: JBList<*>): Int {
        if (!NewUI.isEnabled()) return 0
        val inner = JBUI.CurrentTheme.Popup.Selection.innerInsets()
        val edge = JBUI.CurrentTheme.Popup.Selection.LEFT_RIGHT_INSET.get()
        return edge + if (list.componentOrientation.isLeftToRight) inner.right else inner.left
    }

    private fun Component.labels(): List<String> {
        val own = if (this is JBLabel) listOf(text.orEmpty()) else emptyList()
        if (this !is Container) return own
        return own + components.flatMap { it.labels() }
    }

    private fun Component.html(): List<String> {
        val own = if (this is JBHtmlPane) listOf(text.orEmpty()) else emptyList()
        if (this !is Container) return own
        return own + components.flatMap { it.html() }
    }

    private fun Component.htmlPanes(): List<JBHtmlPane> {
        val own = if (this is JBHtmlPane) listOf(this) else emptyList()
        if (this !is Container) return own
        return own + components.flatMap { it.htmlPanes() }
    }

    private fun Component.treeSize(): Int {
        if (this !is Container) return 1
        return 1 + components.sumOf { it.treeSize() }
    }
}
