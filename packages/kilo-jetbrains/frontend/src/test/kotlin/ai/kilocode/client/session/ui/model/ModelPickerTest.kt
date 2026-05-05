package ai.kilocode.client.session.ui.model

import ai.kilocode.rpc.dto.ModelSelectionDto
import com.intellij.icons.AllIcons
import com.intellij.ui.CollectionListModel
import com.intellij.ui.ExperimentalUI
import com.intellij.ui.components.JBList
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.JBUI
import java.awt.ComponentOrientation
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
        assertEquals("openai/gpt-4o", rows[0].item.key)
        assertEquals("Recommended", modelPickerSectionTitle(rows, 1))
        assertEquals("kilo/auto", rows[1].item.key)
        assertEquals("anthropic/claude", rows[2].item.key)
    }

    fun `test favorites are hidden while filtering`() {
        val rows = modelPickerRows(listOf(
            item("gpt-4o", "GPT 4o", "openai", "OpenAI"),
            item("claude", "Claude Sonnet", "anthropic", "Anthropic"),
        ), listOf(ModelSelectionDto("openai", "gpt-4o")), "gpt")


        assertFalse(rows.indices.any { modelPickerSectionTitle(rows, it) == "Favorites" })
        assertEquals("openai/gpt-4o", rows.single().item.key)
    }

    fun `test favorites match provider qualified key when model ids collide`() {
        val rows = modelPickerRows(listOf(
            item("gpt", "OpenAI GPT", "openai", "OpenAI"),
            item("gpt", "Azure GPT", "azure", "Azure"),
        ), listOf(ModelSelectionDto("azure", "gpt")), "")

        assertEquals("azure/gpt", rows[0].item.key)
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

        assertEquals(listOf("openai/b", "openai/a"), rows.take(2).map { it.item.key })
        assertTrue(rows.take(2).all { it.favorite })
    }

    fun `test filter matches model id and provider name`() {
        val rows = modelPickerRows(listOf(
            item("claude-sonnet", "Sonnet", "anthropic", "Anthropic"),
            item("gpt", "GPT", "openai", "OpenAI"),
        ), emptyList(), "anth")

        assertEquals(listOf("anthropic/claude-sonnet"), rows.map { it.item.key })
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
        assertEquals("openai/a", rows[modelPickerIndex(rows, 1)].item.key)
    }

    fun `test index caps after favorite removal`() {
        val rows = modelPickerRows(listOf(
            item("a", "A", "openai", "OpenAI"),
        ), emptyList(), "")

        assertEquals(0, modelPickerIndex(rows, 1))
        assertEquals(-1, modelPickerIndex(emptyList(), 1))
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
    }

    private fun item(
        id: String,
        display: String,
        provider: String,
        name: String,
        index: Double? = null,
        free: Boolean = false,
    ) = ModelPicker.Item(id, display, provider, name, index, free = free)

    private fun favoriteInset(list: JBList<*>): Int {
        if (!ExperimentalUI.isNewUI()) return 0
        val inner = JBUI.CurrentTheme.Popup.Selection.innerInsets()
        val edge = JBUI.CurrentTheme.Popup.Selection.LEFT_RIGHT_INSET.get()
        return edge + if (list.componentOrientation.isLeftToRight) inner.right else inner.left
    }
}
