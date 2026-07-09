package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.SessionFileOpener
import ai.kilocode.client.session.model.Content
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.ToolExecState
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.ui.selection.SessionSelection
import ai.kilocode.client.session.views.base.PartView
import ai.kilocode.client.ui.md.MdViewFactory
import ai.kilocode.client.session.openSessionLink
import com.intellij.openapi.util.Disposer
import java.awt.BorderLayout

class PlanExitView(
    tool: Tool,
    private val openFile: SessionFileOpener,
    private val openUrl: (String) -> Unit = {},
    selection: SessionSelection? = null,
) : PartView() {

    companion object {
        fun canRender(tool: Tool): Boolean = tool.name == "plan_exit" && tool.state == ToolExecState.COMPLETED
    }

    override val contentId: String = tool.id

    private var item = tool
    private val md = MdViewFactory.create(SessionEditorStyle.current(), selection)

    init {
        layout = BorderLayout()
        isOpaque = false
        Disposer.register(this, md)
        md.addLinkListener { openSessionLink(it, openFile, openUrl) }
        add(md.component, BorderLayout.CENTER)
        applyStyle(SessionEditorStyle.current())
        sync()
    }

    override fun update(content: Content) {
        if (content !is Tool) return
        item = content
        sync()
    }

    override fun applyStyle(style: SessionEditorStyle) {
        md.applyStyle(style)
        md.font = style.transcriptFont
        md.codeFont = style.editorFamily
        md.foreground = style.editorForeground
        refresh()
    }

    fun markdown(): String = md.markdown()

    internal fun simulateLink(href: String) = md.simulateLink(href)

    private fun sync() {
        val plan = plan(item)
        val text = listOf(KiloBundle.message("session.part.plan.ready"), link(plan))
            .filterNotNull()
            .joinToString(" ")
        md.set(text)
        refresh()
    }

    private fun refresh() {
        revalidate()
        repaint()
    }

    override fun dumpLabel() = "PlanExitView#$contentId"
}

private fun plan(tool: Tool): String {
    tool.metadata["plan"]?.takeIf { it.isNotBlank() }?.let { return it }
    val out = tool.output ?: return ""
    return Regex("Plan is ready at (.+?)(?:\\. Ending planning turn\\.|$)")
        .find(out)
        ?.groupValues
        ?.getOrNull(1)
        ?.trim()
        ?: ""
}

private fun link(plan: String): String? {
    if (plan.isBlank()) return null
    val text = plan.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]")
    val href = plan.replace(" ", "%20").replace("(", "%28").replace(")", "%29")
    return "[$text]($href)"
}
