package ai.kilocode.client.settings.marketplace

import ai.kilocode.client.ui.UiStyle
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.MarketplaceItemDto
import ai.kilocode.rpc.dto.MarketplaceMethodDto
import ai.kilocode.rpc.dto.MarketplaceParamDto
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.EditorNotificationPanel.Status
import com.intellij.ui.components.JBTextField
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import java.awt.Component
import java.awt.Container
import java.awt.event.ComponentEvent
import javax.swing.JComponent
import javax.swing.JEditorPane
import javax.swing.JLabel
import javax.swing.ScrollPaneConstants

class MarketplaceInstallDialogTest : BasePlatformTestCase() {

    fun `test header is a standard information banner carrying the description`() {
        withDialog(item(description = LONG)) { dialog ->
            val banner = wrapBanner(dialog.header()!!)
            assertEquals("the header must read as information, not a warning", Status.Info, banner.status)

            val text = bannerText(banner)
            assertTrue("header shows the catalog description", text.contains("Looks up library documentation"))
            assertTrue("header wraps at a column", text.contains("width=\"${bannerColumn(dialog)}\""))
        }
    }

    fun `test header is omitted when the item has no description`() {
        withDialog(item(description = "  ")) { dialog ->
            assertNull("a blank description must not leave an empty header", dialog.header())
        }
    }

    fun `test header wraps to the width the form needs, not a narrower fixed column`() {
        withDialog(item(type = "mcp", description = LONG, params = wideParams())) { dialog ->
            val form = dialog.centerComponent().preferredSize.width
            val header = dialog.header()!!.preferredSize.width

            assertTrue("a form this wide must exceed the default column", form > UiStyle.Text.bodyWidth())
            assertTrue(
                "the header should fill the form's width rather than stop short (form $form, header $header)",
                header >= form - UiStyle.Gap.pad() * 2 - JBUI.scale(8),
            )
            assertTrue("the header must not widen the dialog past the form", header <= form)
        }
    }

    fun `test a long description wraps downward instead of widening the dialog`() {
        val long = withDialog(item(description = LONG)) { it.header()!!.preferredSize }
        val short = withDialog(item(description = "Short.")) { it.header()!!.preferredSize }

        assertEquals("description length must not drive header width", short.width, long.width)
        assertTrue(
            "the long description should grow downward, not sideways (${short.height} -> ${long.height})",
            long.height > short.height,
        )
    }

    fun `test the header banner re-wraps when it is given a wider width`() {
        withDialog(item(description = LONG)) { dialog ->
            val banner = wrapBanner(dialog.header()!!)
            val before = bannerText(banner)
            val wider = banner.preferredSize.width * 2

            banner.setSize(wider, banner.preferredSize.height)
            edtWait { banner.dispatchEvent(ComponentEvent(banner, ComponentEvent.COMPONENT_RESIZED)) }

            assertTrue("a resize must re-wrap to the new width", bannerText(banner) != before)
            assertTrue(
                "the new wrap uses the wider column",
                bannerText(banner).contains("width=\"${wider - WrapBanner.chrome()}\""),
            )
        }
    }

    /**
     * `pack()` itself cannot be asserted here: a headless dialog has no window or root pane, so the
     * packed size is unobservable (see the PR's manual verification steps). What is checkable is the
     * setup that makes packing produce a scroll-free dialog — the content height is requested in full
     * rather than capped, nothing horizontal ever scrolls, and no remembered size can override it.
     */
    fun `test the dialog asks for its full content height and persists no size`() {
        withDialog(item(type = "mcp", description = LONG, params = wideParams(), prerequisites = listOf("Docker"))) { dialog ->
            val scroll = dialog.centerComponent() as JBScrollPane
            val content = scroll.viewport.view.preferredSize

            assertEquals(
                "the scroll pane must not cap the form's height, or pack() would leave it scrolling",
                content.height,
                scroll.preferredSize.height,
            )
            assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER, scroll.horizontalScrollBarPolicy)
            assertEquals(ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED, scroll.verticalScrollBarPolicy)
            assertNull("a remembered size must not override packing", dialog.dimensionKey())
        }
    }


    fun `test the mcp security note wraps instead of widening the dialog`() {
        withDialog(item(type = "mcp")) { dialog ->
            val note = labels(dialog.centerComponent()).single { it.contains("Only install servers you trust") }
            assertTrue("the security note wraps", note.startsWith("<html>"))
            assertTrue(note.contains("width=\"${UiStyle.Text.bodyWidth()}\""))
        }
    }

    fun `test prerequisites render one per line rather than a run-together label`() {
        val prereqs = listOf("Python and uv", "A GitLab account", "A personal access token")
        withDialog(item(type = "mcp", prerequisites = prereqs)) { dialog ->
            val bullets = labels(dialog.centerComponent()).single { it.contains("Python and uv") }
            assertFalse("a raw newline would collapse into one line", bullets.contains("\n"))
            prereqs.forEach { assertTrue("$it is listed", bullets.contains(it)) }
            assertEquals("each prerequisite gets its own line", prereqs.size, bullets.split("<div").size - 2)
        }
    }

    fun `test combo boxes are sized for their widest entry, not the selected one`() {
        val methods = listOf(
            MarketplaceMethodDto("UVX"),
            MarketplaceMethodDto("Docker with a long descriptive method name"),
        )
        withDialog(item(type = "mcp", methods = methods)) { dialog ->
            for (combo in combos(dialog.centerComponent())) {
                val items = (0 until combo.itemCount).map { combo.getItemAt(it) as String }
                val widest = items.maxBy { it.length }

                assertEquals("the combo must size to its widest entry", widest, combo.prototypeDisplayValue)
                assertTrue(
                    "the combo must be at least as wide as one built only for '$widest'",
                    combo.preferredSize.width >= ComboBox(arrayOf(widest)).preferredSize.width,
                )
            }
        }
    }

    fun `test the scope combo width is stable across selection and offers global`() {
        withDialog(item()) { dialog ->
            val combo = combos(dialog.centerComponent()).first()
            val items = (0 until combo.itemCount).map { combo.getItemAt(it) as String }

            assertEquals("scope offers exactly this workspace and global", listOf("This workspace", "Global"), items)

            val before = combo.preferredSize.width
            for (option in items) {
                combo.selectedItem = option
                assertEquals("selecting '$option' must not change the combo's width", before, combo.preferredSize.width)
            }
            assertTrue(
                "the combo must fit its widest option rather than ellipsize it",
                before >= ComboBox(arrayOf(items.maxBy { it.length })).preferredSize.width,
            )
        }
    }

    fun `test the action follows the chosen scope, installing where absent and uninstalling where present`() {
        withDialog(item(installedProject = true)) { dialog ->
            // Opens on a scope the item is missing from, so Install still means install.
            assertEquals("Global", dialog.scopeBox().selectedItem)
            assertFalse(dialog.uninstalls())
            assertEquals("Install", dialog.okText())
            assertEquals("Install GitLab", dialog.title)
            assertFalse("installing must not be pre-marked as a removal", dialog.result().remove)

            dialog.scopeBox().selectedItem = "This workspace"

            assertTrue(dialog.uninstalls())
            assertEquals("Uninstall", dialog.okText())
            assertEquals("Uninstall GitLab", dialog.title)
            val request = dialog.result()
            assertTrue(request.remove)
            assertEquals("project", request.target)
            assertTrue("a removal configures nothing", request.parameters.isEmpty())
        }
    }

    fun `test an item installed in both scopes uninstalls from whichever scope is chosen`() {
        withDialog(item(installedProject = true, installedGlobal = true)) { dialog ->
            assertTrue(dialog.uninstalls())
            assertEquals("project", dialog.result().target)

            dialog.scopeBox().selectedItem = "Global"

            assertTrue(dialog.uninstalls())
            assertEquals("global", dialog.result().target)
        }
    }

    fun `test uninstalling hides the install-only form and skips its validation`() {
        val item = item(
            type = "mcp",
            installedProject = true,
            params = listOf(MarketplaceParamDto("Token", "token")),
            prerequisites = listOf("Docker"),
            methods = listOf(MarketplaceMethodDto("UVX"), MarketplaceMethodDto("Docker")),
        )
        withDialog(item) { dialog ->
            dialog.scopeBox().selectedItem = "This workspace"

            assertTrue("a removal asks for no parameters", fields(dialog.centerComponent()).isEmpty())
            val shown = labels(dialog.centerComponent())
            assertTrue("prerequisites are install-only", shown.none { it.contains("Docker") })
            assertTrue("the security note is install-only", shown.none { it.contains("Only install servers you trust") })

            dialog.scopeBox().selectedItem = "Global"

            assertEquals("switching back to an install asks for its parameters again", 1, fields(dialog.centerComponent()).size)
            assertTrue(labels(dialog.centerComponent()).any { it.contains("Docker") })
        }
    }

    fun `test the selected installation method drives which parameters are asked for`() {
        val item = item(
            type = "mcp",
            methods = listOf(
                MarketplaceMethodDto("UVX", parameters = listOf(MarketplaceParamDto("Token", "token"))),
                MarketplaceMethodDto("Docker", parameters = listOf(MarketplaceParamDto("Image", "image"))),
            ),
        )
        withDialog(item) { dialog ->
            val method = dialog.methodBox()

            // Default method: only its own parameter is asked for, and it is what gets sent.
            assertEquals("UVX", method.selectedItem)
            assertEquals(listOf("Token"), dialog.paramLabels())
            fields(dialog.centerComponent()).single().text = "secret"
            assertEquals(mapOf("token" to "secret", "__method" to "UVX"), dialog.result().parameters)

            // Switching method must swap the form over to that method's parameters, not keep the first's.
            method.selectedItem = "Docker"

            assertEquals(listOf("Image"), dialog.paramLabels())
            fields(dialog.centerComponent()).single().text = "ghcr.io/example"
            assertEquals(mapOf("image" to "ghcr.io/example", "__method" to "Docker"), dialog.result().parameters)
        }
    }

    private fun item(
        type: String = "agent",
        description: String = "Plans work",
        prerequisites: List<String> = emptyList(),
        methods: List<MarketplaceMethodDto> = emptyList(),
        params: List<MarketplaceParamDto> = emptyList(),
        installedProject: Boolean = false,
        installedGlobal: Boolean = false,
    ) = MarketplaceItemDto(
        id = "gitlab",
        type = type,
        name = "GitLab",
        description = description,
        category = "tools",
        prerequisites = prerequisites,
        parameters = params,
        methods = methods,
        content = "{}",
        installedProject = installedProject,
        installedGlobal = installedGlobal,
    )

    private fun MarketplaceInstallDialog.scopeBox() = combos(centerComponent()).first()

    /** The installation-method combo; the scope combo is the first, so this is the one after it. */
    private fun MarketplaceInstallDialog.methodBox() = combos(centerComponent())[1]

    /** Labels of the parameter rows currently on the form, in order. */
    private fun MarketplaceInstallDialog.paramLabels(): List<String> {
        val texts = fields(centerComponent()).map { field ->
            generateSequence(field.parent) { it.parent }
                .filterIsInstance<Container>()
                .firstNotNullOfOrNull { row -> labels(row).firstOrNull() }
        }
        return texts.filterNotNull()
    }

    private fun MarketplaceInstallDialog.okText(): String =
        DialogWrapper::class.java.getDeclaredMethod("getOKAction")
            .also { it.isAccessible = true }
            .invoke(this)
            .let { (it as javax.swing.Action).getValue(javax.swing.Action.NAME) as String }

    /** Parameters whose labels force the form wider than the default description column. */
    private fun wideParams() = listOf(
        MarketplaceParamDto("Confluence URL for your Atlassian Cloud site", "confluenceUrl"),
        MarketplaceParamDto("Personal access token with read and write scopes", "token"),
    )

    private fun fields(root: Component): List<JBTextField> {
        val out = mutableListOf<JBTextField>()
        fun visit(c: Component) {
            if (!c.isVisible) return
            if (c is JBTextField) out.add(c)
            if (c is Container) c.components.forEach { visit(it) }
        }
        visit(root)
        return out
    }

    private fun combos(root: Component): List<ComboBox<*>> {
        val out = mutableListOf<ComboBox<*>>()
        fun visit(c: Component) {
            if (c is ComboBox<*>) out.add(c)
            if (c is Container) c.components.forEach { visit(it) }
        }
        visit(root)
        return out
    }

    /** The banner renders into an HTML editor pane, so its copy is read from there rather than a label. */
    private fun bannerText(banner: WrapBanner): String {
        val out = mutableListOf<String>()
        fun visit(c: Component) {
            if (c is JEditorPane) c.text?.let { out.add(it) }
            if (c is Container) c.components.forEach { visit(it) }
        }
        visit(banner)
        return out.single()
    }

    /** The column the banner wraps at: the header width minus the banner's own icon and insets. */
    private fun bannerColumn(dialog: MarketplaceInstallDialog): Int {
        val form = dialog.centerComponent().preferredSize.width
        return (form - UiStyle.Gap.pad() * 2).coerceAtLeast(UiStyle.Text.bodyWidth()) - WrapBanner.chrome()
    }

    private fun wrapBanner(root: Component): WrapBanner {
        val out = mutableListOf<WrapBanner>()
        fun visit(c: Component) {
            if (c is WrapBanner) out.add(c)
            if (c is Container) c.components.forEach { visit(it) }
        }
        visit(root)
        return out.single()
    }

    private fun MarketplaceInstallDialog.dimensionKey(): String? =
        DialogWrapper::class.java.getDeclaredMethod("getDimensionServiceKey")
            .also { it.isAccessible = true }
            .invoke(this) as String?

    private fun <T> withDialog(item: MarketplaceItemDto, block: (MarketplaceInstallDialog) -> T): T = edtWait {
        val dialog = MarketplaceInstallDialog(item, hasProjectDirectory = true)
        try {
            block(dialog)
        } finally {
            dialog.close(DialogWrapper.CANCEL_EXIT_CODE)
        }
    }

    /**
     * The platform builds its header from the protected `createNorthPanel` slot, and headless dialogs
     * never assemble a content pane to read it back from. Reached reflectively so production keeps no
     * accessor that exists only for this test.
     */
    private fun MarketplaceInstallDialog.header(): JComponent? =
        DialogWrapper::class.java.getDeclaredMethod("createNorthPanel")
            .also { it.isAccessible = true }
            .invoke(this) as JComponent?

    /** Skips hidden subtrees, so what this returns is what the dialog actually shows. */
    private fun labels(root: Component): List<String> {
        val out = mutableListOf<String>()
        fun visit(c: Component) {
            if (!c.isVisible) return
            if (c is JLabel) c.text?.takeIf { it.isNotBlank() }?.let { out.add(it) }
            if (c is Container) c.components.forEach { visit(it) }
        }
        visit(root)
        return out
    }

    private companion object {
        const val LONG =
            "Looks up library documentation and returns focused, version-accurate excerpts so the agent " +
                "does not have to guess at an API surface it has not seen before in this workspace."
    }
}
