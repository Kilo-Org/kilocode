package ai.kilocode.client.session.ui.model

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.ui.FilledBadgeIcon
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import ai.kilocode.client.ui.md.MdView
import ai.kilocode.client.ui.md.MdViewFactory
import com.intellij.icons.AllIcons
import com.intellij.ide.BrowserUtil
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.xml.util.XmlStringUtil
import java.awt.BorderLayout
import java.awt.Cursor
import java.awt.FlowLayout
import java.text.NumberFormat
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants

internal class ModelDetailsPanel(
    private val favorites: () -> Set<String>,
    private val toggle: (ModelPicker.Item) -> Unit,
) : JPanel(BorderLayout()), Disposable {
    private val empty = JBLabel(KiloBundle.message("model.picker.details.empty")).apply {
        foreground = UIUtil.getContextHelpForeground()
    }
    private val title = JBLabel().apply { font = UiStyle.Fonts.bold() }
    private val provider = JBLabel().apply { foreground = UIUtil.getContextHelpForeground() }
    private val star = JBLabel().apply {
        cursor = Cursor.getPredefinedCursor(Cursor.HAND_CURSOR)
        horizontalAlignment = JBLabel.CENTER
        verticalAlignment = JBLabel.CENTER
    }
    private val head = JPanel(BorderLayout()).apply {
        add(Stack.vertical(UiStyle.Gap.xs()).next(title).next(provider), BorderLayout.CENTER)
        add(star, BorderLayout.EAST)
    }
    private val free = badge(ModelText.freeLabel())
    private val byok = badge("BYOK")
    private val data = badge(KiloBundle.message("model.picker.dataCollected"))
    private val latest = badge(KiloBundle.message("model.picker.details.latest"))
    private val badges = Stack.horizontal(UiStyle.Gap.xs()).next(free).next(byok).next(data).next(latest)
    private val props = RowsSection(KiloBundle.message("model.picker.details.properties"))
    private val bench = RowsSection(KiloBundle.message("model.picker.details.terminalBench"))
    private val caps = TagsSection(KiloBundle.message("model.picker.details.capabilities"))
    private val desc = MarkdownSection(KiloBundle.message("model.picker.details.description"))
    private val routeText = JBLabel().apply {
        foreground = UIUtil.getLabelForeground()
        setAllowAutoWrapping(true)
    }
    private val route = Stack.vertical(UiStyle.Gap.xs())
        .next(heading(KiloBundle.message("model.picker.details.autoRouting")))
        .next(routeText)
    private val ids = RowsSection(KiloBundle.message("model.picker.details.ids"))
    private val body = Stack.vertical(UiStyle.Gap.sm()).apply {
        border = JBUI.Borders.empty(UiStyle.Gap.md(), UiStyle.Gap.lg(), UiStyle.Gap.md(), UiStyle.Gap.xl())
        next(empty)
        next(head)
        next(badges)
        next(props.root)
        next(bench.root)
        next(caps.root)
        next(desc.root)
        next(route)
        next(ids.root)
    }
    private val scroll = JBScrollPane(body).apply {
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
        border = JBUI.Borders.empty()
        viewportBorder = JBUI.Borders.empty()
    }
    private var item: ModelPicker.Item? = null

    init {
        border = JBUI.Borders.customLineLeft(UIUtil.getBoundsColor())
        add(scroll, BorderLayout.CENTER)
        star.addMouseListener(object : java.awt.event.MouseAdapter() {
            override fun mouseClicked(e: java.awt.event.MouseEvent) {
                item?.let {
                    toggle(it)
                    update(it)
                }
            }
        })
        showEmpty()
    }

    fun update(value: ModelPicker.Item?) {
        item = value
        if (value == null) {
            showEmpty()
            refresh()
            return
        }

        empty.isVisible = false
        head.isVisible = true
        title.sync(ModelText.parts(value).model)
        provider.sync(value.providerName)
        syncStar(value)
        syncBadges(value)
        props.update(properties(value))
        bench.update(bench(value))
        caps.update(capabilities(value))
        desc.update(value.options?.description?.takeIf { it.isNotBlank() }?.let(::descriptionText))
        syncRouting(value)
        ids.update(listOf(
            KiloBundle.message("model.picker.details.providerId") to value.provider,
            KiloBundle.message("model.picker.details.modelId") to value.id,
        ))
        refresh()
    }

    private fun showEmpty() {
        empty.isVisible = true
        head.isVisible = false
        badges.isVisible = false
        props.update(emptyList())
        bench.update(emptyList())
        caps.update(emptyList())
        desc.update(null)
        route.isVisible = false
        ids.update(emptyList())
    }

    private fun syncStar(value: ModelPicker.Item) {
        val selected = value.key in favorites()
        star.icon = if (selected) AllIcons.Nodes.Favorite else AllIcons.Nodes.NotFavoriteOnHover
        star.toolTipText = if (selected) {
            KiloBundle.message("model.picker.favorite.remove")
        } else {
            KiloBundle.message("model.picker.favorite.add")
        }
    }

    private fun syncBadges(value: ModelPicker.Item) {
        free.isVisible = value.free && !value.byok
        byok.isVisible = value.byok
        data.isVisible = ModelText.collectsData(value)
        latest.isVisible = value.latest == true
        badges.isVisible = free.isVisible || byok.isVisible || data.isVisible || latest.isVisible
    }

    private fun properties(item: ModelPicker.Item): List<Pair<String, String>> {
        val ctx = item.limit?.context?.takeIf { it > 0 } ?: item.contextLength?.takeIf { it > 0 }
        return buildList {
            item.releaseDate?.let { add(KiloBundle.message("model.picker.details.released") to date(it)) }
            if (!item.free) {
                item.cost?.let { cost ->
                    add(KiloBundle.message("model.picker.details.input") to price(cost.input))
                    add(KiloBundle.message("model.picker.details.output") to price(cost.output))
                    add(KiloBundle.message("model.picker.details.cached") to cached(cost.input, cost.cache?.read))
                    add(KiloBundle.message("model.picker.details.average") to price(average(cost.input, cost.output, cost.cache?.read)))
                } ?: run {
                    item.inputPrice?.let { add(KiloBundle.message("model.picker.details.input") to price(it)) }
                    item.outputPrice?.let { add(KiloBundle.message("model.picker.details.output") to price(it)) }
                }
            }
            ctx?.let { add(KiloBundle.message("model.picker.details.context") to context(it)) }
        }
    }

    private fun bench(item: ModelPicker.Item): List<Pair<String, String>> {
        val bench = item.terminalBench ?: return emptyList()
        return listOf(
            KiloBundle.message("model.picker.details.completion") to percent(bench.overallScore),
            KiloBundle.message("model.picker.details.costAttempt") to attempt(bench.avgAttemptCostUsd),
        )
    }

    private fun capabilities(item: ModelPicker.Item): List<String> {
        val cap = item.capabilities
        return buildList {
            if (cap?.reasoning == true || item.reasoning) add(KiloBundle.message("model.picker.details.reasoning"))
            val input = cap?.input
            if (input?.text == true) add(KiloBundle.message("model.picker.details.modality.text"))
            if (input?.image == true) add(KiloBundle.message("model.picker.details.modality.image"))
            if (input?.audio == true) add(KiloBundle.message("model.picker.details.modality.audio"))
            if (input?.video == true) add(KiloBundle.message("model.picker.details.modality.video"))
            if (input?.pdf == true) add(KiloBundle.message("model.picker.details.modality.pdf"))
            if (item.attachment) add(KiloBundle.message("model.picker.details.attachments"))
        }
    }

    private fun syncRouting(item: ModelPicker.Item) {
        val models = item.autoRouting?.models?.takeIf { it.isNotEmpty() }
        route.isVisible = models != null
        if (models == null) return
        routeText.sync(XmlStringUtil.wrapInHtml(XmlStringUtil.escapeString(models.joinToString("\n"))))
    }

    private fun refresh() {
        body.revalidate()
        body.repaint()
    }

    override fun dispose() {
        desc.dispose()
    }
}

private class RowsSection(title: String) {
    private val rows = Stack.vertical(UiStyle.Gap.xs())
    private val pool = mutableListOf<DetailRow>()
    val root = Stack.vertical(UiStyle.Gap.xs())
        .next(heading(title))
        .next(rows)

    fun update(values: List<Pair<String, String>>) {
        root.isVisible = values.isNotEmpty()
        values.forEachIndexed { idx, value ->
            val row = row(idx)
            row.update(value.first, value.second)
            row.isVisible = true
        }
        for (idx in values.size until pool.size) {
            pool[idx].isVisible = false
        }
        rows.revalidate()
        rows.repaint()
    }

    private fun row(idx: Int): DetailRow {
        pool.getOrNull(idx)?.let { return it }
        val row = DetailRow()
        pool.add(row)
        rows.next(row)
        return row
    }
}

private class DetailRow : JPanel(BorderLayout()) {
    private val name = JBLabel().apply { foreground = UIUtil.getContextHelpForeground() }
    private val value = JBLabel().apply { foreground = UIUtil.getLabelForeground() }

    init {
        add(name, BorderLayout.WEST)
        add(value, BorderLayout.EAST)
    }

    fun update(label: String, text: String) {
        name.isVisible = label.isNotBlank()
        name.sync(label)
        value.sync(text)
    }
}

private class TagsSection(title: String) {
    private val tags = TagPanel()
    private val pool = mutableListOf<JBLabel>()
    val root = Stack.vertical(UiStyle.Gap.xs())
        .next(heading(title))
        .next(tags)

    fun update(values: List<String>) {
        root.isVisible = values.isNotEmpty()
        values.forEachIndexed { idx, value ->
            val tag = tag(idx)
            tag.icon = FilledBadgeIcon(value, tagBackground(idx), UiStyle.Colors.fg())
            tag.toolTipText = value
            tag.isVisible = true
        }
        for (idx in values.size until pool.size) {
            pool[idx].isVisible = false
        }
        tags.revalidate()
        tags.repaint()
    }

    private fun tag(idx: Int): JBLabel {
        pool.getOrNull(idx)?.let { return it }
        val tag = JBLabel()
        pool.add(tag)
        tags.add(tag)
        return tag
    }
}

private class MarkdownSection(title: String) : Disposable {
    val root = Stack.vertical(UiStyle.Gap.xs()).next(heading(title))
    private var view: MdView? = null

    fun update(text: String?) {
        root.isVisible = text != null
        if (text == null) return
        val md = view ?: MdViewFactory.create(SessionEditorStyle.current()).apply {
            opaque = false
            addLinkListener { BrowserUtil.browse(it.href) }
        }.also {
            view = it
            root.next(it.component)
        }
        md.set(text)
    }

    override fun dispose() {
        view?.let(Disposer::dispose)
        view = null
    }
}

private class TagPanel : JPanel(FlowLayout(FlowLayout.LEFT, UiStyle.Gap.sm(), UiStyle.Gap.xs())) {
    init {
        isOpaque = false
    }
}

private fun heading(value: String) = JBLabel(value).apply { font = UiStyle.Fonts.bold() }

private fun badge(value: String) = JBLabel(value).apply {
    border = JBUI.Borders.empty(UiStyle.Gap.xs(), UiStyle.Gap.sm(), UiStyle.Gap.xs(), UiStyle.Gap.sm())
    foreground = UIUtil.getLabelForeground()
}

private fun JBLabel.sync(value: String) {
    if (text == value) return
    text = value
}

private fun context(value: Long): String {
    if (value >= 1_000_000) return "${format(value.toDouble() / 1_000_000.0)}M"
    if (value >= 1_000) return "${format(value.toDouble() / 1_000.0)}K"
    return value.toString()
}

private fun price(value: Double): String {
    if (value == 0.0) return KiloBundle.message("model.picker.free")
    val digits = if (value < 0.01) 4 else 2
    return "$${value.format(digits)}/1M"
}

private fun cached(input: Double, read: Double?): String {
    if (read != null) return price(read)
    if (input == 0.0) return price(0.0)
    return KiloBundle.message("model.picker.details.notSupported")
}

private fun average(input: Double, output: Double, read: Double?): Double {
    if (read != null) return read * 0.7 + input * 0.2 + output * 0.1
    return input * 0.9 + output * 0.1
}

private fun percent(value: Double) = "${(value * 100.0).format(1)}%"

private fun attempt(value: Double) = "$${value.format(2)}"

private fun date(value: String): String = runCatching {
    LocalDate.parse(value).format(DateTimeFormatter.ofPattern("MMM yyyy"))
}.getOrDefault(value)

private fun descriptionText(value: String): String = value
    .replace(Regex("(?<![\\[<(])\\b(https?://[^\\s<>()`\"']+)([),.;!?])?")) { match ->
        val url = match.groupValues[1]
        val tail = match.groupValues.getOrNull(2).orEmpty()
        "[$url]($url)$tail"
    }

private fun tagBackground(index: Int) = when (index % 4) {
    0 -> UiStyle.Colors.badgeBg()
    1 -> UiStyle.Colors.blend(UiStyle.Colors.contentBackground(), UiStyle.Colors.fg(), 0.12f)
    2 -> UiStyle.Colors.blend(UiStyle.Colors.contentBackground(), JBUI.CurrentTheme.Link.Foreground.ENABLED, 0.18f)
    else -> UiStyle.Colors.blend(UiStyle.Colors.contentBackground(), UiStyle.Colors.activityBadgeBg(), 0.18f)
}

private fun format(value: Double): String = NumberFormat.getNumberInstance(Locale.getDefault()).apply {
    maximumFractionDigits = if (value % 1.0 == 0.0) 0 else 1
}.format(value)

private fun Double.format(digits: Int) = String.format(Locale.US, "%.${digits}f", this)
