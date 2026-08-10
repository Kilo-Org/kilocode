package ai.kilocode.client.session.views.tool

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.ui.layout.Stack
import com.intellij.openapi.Disposable
import com.intellij.ui.EditorTextField
import com.intellij.ui.HyperlinkLabel
import com.intellij.ui.components.JBLabel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.intellij.util.ui.JBUI
import java.awt.Component
import javax.swing.JComponent

/**
 * Placeholder shown in place of an embedded diff editor when a diff exceeds
 * [ai.kilocode.client.session.ui.style.SessionUiStyle.View.Tool.DIFF_MAX_LINES]. Building an editor
 * for such a diff walks every line on the EDT (gutter reinit) and freezes the UI, so the popup and
 * inline body defer to the platform diff tab, which streams file diffs on background threads.
 */
@RequiresEdt
internal fun diffOverflowPanel(open: () -> Unit): JComponent {
    val message = JBLabel(KiloBundle.message("diff.overflow.message")).apply {
        foreground = UiStyle.Colors.weak()
    }
    val link = HyperlinkLabel(KiloBundle.message("diff.overflow.open")).apply {
        addHyperlinkListener { open() }
    }
    val body = Stack.vertical(gap = UiStyle.Gap.sm())
        .next(message)
        .next(link)
    return JBUI.Panels.simplePanel(body).apply {
        isOpaque = false
        border = JBUI.Borders.empty(UiStyle.Gap.pad())
    }
}

/**
 * [EditBody] that renders the large-diff placeholder for a single-file edit whose diff is too large
 * to preview inline or in a hover popup. Multi-file diffs are capped inside [PatchBody] directly, so
 * this only covers the single-file edit/write case that [PatchBody] cannot render.
 */
internal class OverflowBody : EditBody {
    override var parent: Disposable? = null
    override var overflow: (() -> Unit)? = null
    private var root: JComponent? = null

    @RequiresEdt
    override fun mount(tool: Tool): JComponent {
        root?.let { return it }
        val open = overflow ?: {}
        return diffOverflowPanel(open).also { root = it }
    }

    @RequiresEdt override fun created(): Boolean = root != null

    @RequiresEdt override fun panel(): JComponent? = root

    @RequiresEdt override fun attached(host: Component): Boolean = root?.parent === host

    // The placeholder text is fixed once shown; a diff that crosses back under the cap swaps this body
    // out for a real one via EditToolView.swapBody, so no in-place update is needed here.
    @RequiresEdt override fun update(tool: Tool): Boolean = false

    @RequiresEdt override fun applyStyle(style: SessionEditorStyle): Boolean = false

    @RequiresEdt override fun markdown(): String? = null

    @RequiresEdt override fun codeEditors(): List<EditorTextField> = emptyList()

    @RequiresEdt override fun disposeBody() {
        root = null
    }
}
