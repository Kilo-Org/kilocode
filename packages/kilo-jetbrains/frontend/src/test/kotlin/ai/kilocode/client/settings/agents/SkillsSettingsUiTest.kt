package ai.kilocode.client.settings.agents

import ai.kilocode.client.app.KiloAgentBehaviorService
import ai.kilocode.client.app.KiloAppService
import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.settings.base.SettingsListItem
import ai.kilocode.client.settings.base.SettingsPathDialogHandle
import ai.kilocode.client.settings.base.settingsListCellBounds
import ai.kilocode.client.testing.FakeAgentBehaviorRpcApi
import ai.kilocode.client.testing.FakeAppRpcApi
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.client.testing.fire
import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.KiloAppStateDto
import ai.kilocode.rpc.dto.KiloAppStatusDto
import ai.kilocode.rpc.dto.SkillDto
import ai.kilocode.rpc.dto.SkillsConfigDto
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.fileTypes.UnknownFileType
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.ui.TestDialog
import com.intellij.openapi.ui.TestDialogManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.testFramework.replaceService
import com.intellij.ui.TitledSeparator
import com.intellij.ui.SimpleColoredComponent
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import java.awt.BorderLayout
import java.awt.Container
import java.awt.Dimension
import java.awt.Point
import java.awt.event.InputEvent
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.ScrollPaneConstants
import javax.swing.Scrollable
import javax.swing.JTextField

class SkillsSettingsUiTest : BasePlatformTestCase() {
    private var scope: CoroutineScope? = null
    private var ui: SkillsSettingsUi? = null
    private lateinit var app: KiloAppService
    private lateinit var appRpc: FakeAppRpcApi
    private lateinit var agentRpc: FakeAgentBehaviorRpcApi
    private lateinit var workspaceRpc: FakeWorkspaceRpcApi
    private var shown = 0

    override fun tearDown() {
        try {
            TestDialogManager.setTestDialog(TestDialog.DEFAULT)
            ui?.let { panel -> edt { panel.dispose(); true } }
            ui = null
            scope?.cancel()
            scope = null
        } finally {
            super.tearDown()
        }
    }

    fun `test loads skills with location note and builtins have no actions`() {
        val panel = panel()

        flushUntil { rows(panel).size == 3 }

        edt {
            val rows = rows(panel)
            val custom = rows.single { it.key == CUSTOM }
            assertEquals("plan", custom.title)
            assertEquals(CUSTOM, custom.note)
            assertEquals("Plan work", custom.description)
            assertEquals("edit", custom.doubleClick)
            assertEquals(listOf("open", "edit", "delete"), custom.cells.map { it.id })
            assertTrue(custom.cells.single { it.id == "open" }.primary)
            assertFalse(custom.cells.single { it.id == "edit" }.primary)
            assertEquals("Edit", custom.cells.single { it.id == "edit" }.label)
            assertTrue(custom.cells.single { it.id == "delete" }.iconOnly)
            val builtin = rows.single { it.key == "builtin" }
            assertEquals("thinking", builtin.title)
            assertNull(builtin.note)
            assertEquals("edit", builtin.doubleClick)
            assertEquals(listOf("built-in"), builtin.badges.map { it.text })
            assertEquals(listOf("edit"), builtin.cells.map { it.id })
            assertEquals("Open", builtin.cells.single().label)
            val remote = rows.single { it.key == REMOTE }
            assertEquals(listOf("edit"), remote.cells.map { it.id })
            assertEquals("Open", remote.cells.single().label)
            assertEquals(listOf(DIR), agentRpc.skillCalls)
            true
        }
    }

    fun `test skills list is vertically scrolled without horizontal scrollbar`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            val pane = scrollFor(panel, skillsList(panel))
            val view = pane.viewport.view
            val layout = panel.content.layout as BorderLayout

            assertEquals(ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER, pane.horizontalScrollBarPolicy)
            assertTrue((view as Scrollable).getScrollableTracksViewportWidth())
            assertFalse(view.getScrollableTracksViewportHeight())
            assertSame(pane, layout.getLayoutComponent(BorderLayout.CENTER))
            assertSame(panel.sources, layout.getLayoutComponent(BorderLayout.SOUTH))
            true
        }
    }

    fun `test sources section has additional sources title`() {
        val panel = panel()
        flushUntil { sourceRows(panel).size == 2 }

        assertTrue(edt {
            components(panel).filterIsInstance<TitledSeparator>().any { it.text == "Additional Skill Sources" }
        })
    }

    fun `test skills list does not show description tooltips`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            val list = skillsList(panel)
            list.size = Dimension(520, 320)
            list.doLayout()
            val bounds = list.getCellBounds(0, 0)

            assertNull(list.getToolTipText(mouse(list, MouseEvent.MOUSE_MOVED, Point(bounds.x + 8, bounds.y + 8))))
            true
        }
    }

    fun `test renderer puts location on first line and description on preview line`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            val list = skillsList(panel)
            val row = rows(panel).single { it.key == CUSTOM }
            val idx = rows(panel).indexOf(row)
            val comp = list.cellRenderer.getListCellRendererComponent(list, row, idx, true, true)
            comp.setSize(520, list.fixedCellHeight)
            layout(comp)
            val title = components(comp).filterIsInstance<SimpleColoredComponent>().single()
            val labels = components(comp).filterIsInstance<JBLabel>().filter { it.isVisible }.map { it.text }

            assertEquals("plan  $CUSTOM", title.toString())
            assertTrue(labels.contains("Plan work"))
            true
        }
    }

    fun `test double click stages skill content until apply`() {
        val panel = panel(edit = { _, _ -> FakeSkillDialog("# Saved") })
        flushUntil { rows(panel).size == 3 }

        doubleClick(skillsList(panel), panel, CUSTOM)

        assertTrue(edt { panel.modified() })
        assertTrue(agentRpc.skillSaves.isEmpty())
        edt { panel.applyDraft(); true }
        flushUntil { agentRpc.skillSaves.size == 1 }
        assertEquals(Triple(DIR, CUSTOM, "# Saved"), agentRpc.skillSaves.single())
    }

    fun `test edited skill row keeps normal actions`() {
        val panel = panel(edit = { _, _ -> FakeSkillDialog("# Draft") })
        flushUntil { rows(panel).size == 3 }

        doubleClick(skillsList(panel), panel, CUSTOM)

        assertEquals(listOf("open", "edit", "delete"), edt { rows(panel).single { it.key == CUSTOM }.cells.map { it.id } })
        assertTrue(edt { panel.modified() })
    }

    fun `test reopening staged skill edit shows draft content before apply`() {
        val seen = mutableListOf<String?>()
        val panel = panel(edit = { skill, _ ->
            seen += skill.content
            FakeSkillDialog(if (seen.size == 1) "# Draft" else "# Draft 2")
        })
        flushUntil { rows(panel).size == 3 }

        doubleClick(skillsList(panel), panel, CUSTOM)
        doubleClick(skillsList(panel), panel, CUSTOM)

        assertEquals(listOf("# Plan\nUse steps", "# Draft"), seen)
        assertTrue(agentRpc.skillSaves.isEmpty())
    }

    fun `test open in editor action opens skill file`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        click(skillsList(panel), panel, CUSTOM, "open")

        assertEquals("The skill file will open after you close Settings.", edt { progressText(panel) })
        flushUntil { workspaceRpc.openedFiles.size == 1 }
        assertEquals(FakeWorkspaceRpcApi.Opened(CUSTOM, null, null), workspaceRpc.openedFiles.single())
    }

    fun `test read only skills open without staging edits or editor file open`() {
        shown = 0
        val panel = panel(edit = { _, savable ->
            assertFalse(savable)
            FakeSkillDialog("# Ignored") { shown += 1 }
        })
        flushUntil { rows(panel).size == 3 }

        click(skillsList(panel), panel, REMOTE, "edit")

        assertEquals(1, shown)
        assertFalse(edt { panel.modified() })
        assertTrue(agentRpc.skillSaves.isEmpty())
        assertTrue(workspaceRpc.openedFiles.isEmpty())
    }

    fun `test skill edit dialog shows content with fallback`() {
        edt {
            val content = SkillEditDialog(SkillDto("plan", "desc", CUSTOM, "# Plan\nUse steps"), true)
            val fallback = SkillEditDialog(SkillDto("plan", "desc", CUSTOM), true)
            val readonly = SkillEditDialog(SkillDto("kilo-config", "desc", "builtin", "<h1>Kilo Config</h1>"), false)
            try {
                assertEquals("# Plan\nUse steps", content.content())
                assertEquals("desc", fallback.content())
                assertEquals("<h1>Kilo Config</h1>", readonly.content())
                assertEquals("OK", content.okText())
            } finally {
                content.close(DialogWrapper.CANCEL_EXIT_CODE)
                fallback.close(DialogWrapper.CANCEL_EXIT_CODE)
                readonly.close(DialogWrapper.CANCEL_EXIT_CODE)
            }
            true
        }
    }

    fun `test skill editor file type follows content syntax before location`() {
        assertEquals(
            FileTypeManager.getInstance().getFileTypeByFileName("index.html"),
            skillFileType("builtin", "<h1>Kilo CLI Configuration Reference</h1><p>All config lives in <code>kilo.json</code>.</p>"),
        )
        assertEquals(
            skillFileType("SKILL.md"),
            skillFileType("builtin", "# Kilo CLI Configuration Reference\n\nAll config lives in `kilo.json`."),
        )
        assertEquals(PlainTextFileType.INSTANCE, skillFileType("builtin", "Plain fallback text"))
    }


    fun `test delete action stages skill removal until apply`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }
        TestDialogManager.setTestDialog(TestDialog.YES)

        click(skillsList(panel), panel, CUSTOM, "delete")

        assertTrue(edt { rows(panel).none { it.key == CUSTOM } })
        assertTrue(agentRpc.skillRemovals.isEmpty())
        edt { panel.applyDraft(); true }
        flushUntil { agentRpc.skillRemovals.size == 1 }
        assertEquals(listOf(DIR to CUSTOM), agentRpc.skillRemovals)
    }

    fun `test delete action requires confirmation`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }
        TestDialogManager.setTestDialog { Messages.NO }

        click(skillsList(panel), panel, CUSTOM, "delete")

        edt { UIUtil.dispatchAllInvocationEvents(); true }
        assertTrue(agentRpc.skillRemovals.isEmpty())
        assertTrue(edt { rows(panel).any { it.key == CUSTOM } })
    }

    fun `test add path and url write skills config patch on apply`() {
        var path = "/extra/skills"
        var url = "https://skills.test/index.json"
        val panel = panel(source = { _, isPath, _ -> FakeSourceDialog(if (isPath) path else url) })
        flushUntil { rows(panel).size == 3 }

        edt { panel.sources.addPath(); true }
        edt { panel.sources.addUrl(); true }
        flushUntil { sourceRows(panel).any { it.key == "url:$url" } }
        assertTrue(appRpc.configPatches.isEmpty())

        edt { panel.applyDraft(); true }
        flushUntil { appRpc.configPatches.size == 1 && !edt { panel.modified() } }

        val paths = appRpc.configPatches.single().skills!!.paths
        val urls = appRpc.configPatches.single().skills!!.urls
        assertEquals(listOf("/global/skills", path), paths)
        assertEquals(listOf("https://skills.test/base.json", url), urls)
        assertEquals(
            listOf("path:/global/skills", "path:$path", "url:https://skills.test/base.json", "url:$url"),
            edt { sourceRows(panel).map { it.key } },
        )
        assertEquals(listOf(DIR), agentRpc.skillReloads)
    }

    fun `test stale config update result keeps added skill sources visible`() {
        val path = "/extra/skills"
        val url = "https://skills.test/index.json"
        val extra = "$path/extra/SKILL.md"
        val panel = panel(source = { _, isPath, _ -> FakeSourceDialog(if (isPath) path else url) })
        appRpc.configUpdateReturnStale = true
        appRpc.afterConfig = { agentRpc.skills = agentRpc.skills + SkillDto("extra", "Extra skill", extra) }
        flushUntil { rows(panel).size == 3 }

        edt {
            panel.sources.addPath()
            panel.sources.addUrl()
            panel.applyDraft()
            true
        }

        flushUntil { appRpc.configPatches.size == 1 && !edt { panel.modified() } }
        assertTrue(edt { rows(panel).any { it.key == extra } })
        assertEquals(
            listOf("path:/global/skills", "path:$path", "url:https://skills.test/base.json", "url:$url"),
            edt { sourceRows(panel).map { it.key } },
        )
    }

    fun `test blocked reload completes apply with warning`() {
        val path = "/extra/skills"
        val panel = panel(source = { _, isPath, _ -> FakeSourceDialog(if (isPath) path else null) })
        agentRpc.reloadSkillResult = false
        flushUntil { rows(panel).size == 3 }

        edt {
            panel.sources.addPath()
            panel.applyDraft()
            true
        }

        flushUntil { appRpc.configPatches.size == 1 && !edt { panel.modified() } }
        assertEquals(listOf(DIR), agentRpc.skillReloads)
        assertEquals("Skills settings saved, but active sessions are present. Reload the core after those sessions finish to apply the new skills.", edt { progressText(panel) })
    }

    fun `test post apply skills refresh failure keeps saved rows`() {
        val panel = panel(edit = { _, _ -> FakeSkillDialog("# Saved") })
        flushUntil { rows(panel).size == 3 }

        doubleClick(skillsList(panel), panel, CUSTOM)
        agentRpc.skillsError = RuntimeException("timeout")
        edt { panel.applyDraft(); true }

        flushUntil { agentRpc.skillSaves.size == 1 && !edt { panel.modified() } }
        assertEquals(listOf(CUSTOM, "builtin", REMOTE), edt { rows(panel).map { it.key } })
        assertEquals("# Saved", agentRpc.skills.single { it.location == CUSTOM }.content)
    }

    fun `test source reset discards staged changes`() {
        val path = "/extra/skills"
        val panel = panel(source = { _, isPath, _ -> FakeSourceDialog(if (isPath) path else null) })
        flushUntil { rows(panel).size == 3 }

        edt { panel.sources.addPath(); true }

        assertTrue(edt { sourceRows(panel).any { it.key == "path:$path" } })
        assertTrue(edt { panel.modified() })
        edt { panel.resetDraft(); true }

        assertTrue(appRpc.configPatches.isEmpty())
        assertEquals(listOf(CUSTOM, "builtin", REMOTE), edt { rows(panel).map { it.key } })
        assertFalse(edt { sourceRows(panel).any { it.key == "path:$path" } })
        assertTrue(agentRpc.skillReloads.isEmpty())
    }

    fun `test delete source writes skills config patch`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 && sourceRows(panel).size == 2 }

        edt {
            sourceList(panel).selectedIndices = intArrayOf(0)
            panel.sources.removeSelected()
            true
        }

        assertTrue(appRpc.configPatches.isEmpty())
        edt { panel.applyDraft(); true }
        flushUntil { appRpc.configPatches.size == 1 && !edt { panel.modified() } }
        val patch = appRpc.configPatches.single().skills!!
        assertEquals(emptyList<String>(), patch.paths)
        assertEquals(listOf("https://skills.test/base.json"), patch.urls)
        assertEquals(listOf("url:https://skills.test/base.json"), edt { sourceRows(panel).map { it.key } })
        assertEquals(listOf(DIR), agentRpc.skillReloads)
    }

    fun `test stale config update result keeps removed skill sources hidden`() {
        val panel = panel()
        appRpc.configUpdateReturnStale = true
        appRpc.afterConfig = { agentRpc.skills = agentRpc.skills.filterNot { it.location == CUSTOM } }
        flushUntil { rows(panel).size == 3 && sourceRows(panel).size == 2 }

        edt {
            sourceList(panel).selectedIndices = intArrayOf(0)
            panel.sources.removeSelected()
            panel.applyDraft()
            true
        }

        flushUntil { appRpc.configPatches.size == 1 && !edt { panel.modified() } }
        assertEquals(listOf("builtin", REMOTE), edt { rows(panel).map { it.key } })
        assertEquals(listOf("url:https://skills.test/base.json"), edt { sourceRows(panel).map { it.key } })
    }

    fun `test search filters skills by name`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }

        edt {
            components(panel).filterIsInstance<JTextField>().single().text = "think"
            UIUtil.dispatchAllInvocationEvents()
            true
        }

        flushUntil { rows(panel).map { it.key } == listOf("builtin") }
    }

    fun `test skills reload failure keeps existing rows`() {
        val panel = panel()
        flushUntil { rows(panel).size == 3 }
        agentRpc.skillsError = RuntimeException("timeout")

        edt { panel.reload(); true }
        flushUntil { edt { skillsList(panel).isEnabled } }

        assertEquals(listOf(CUSTOM, "builtin", REMOTE), edt { rows(panel).map { it.key } })
    }

    fun `test skill editor file type follows location extension`() {
        assertNotSame(UnknownFileType.INSTANCE, skillFileType("/tmp/skills/plan/SKILL.md"))
        assertEquals(
            FileTypeManager.getInstance().getFileTypeByFileName("index.html"),
            skillFileType("/tmp/skills/index.html"),
        )
        assertEquals(PlainTextFileType.INSTANCE, skillFileType("/tmp/skills/index.unknown"))
    }

    fun `test skill path chooser accepts directories only`() {
        val descriptor = skillPathDescriptor()

        assertTrue(descriptor.isChooseFolders)
        assertFalse(descriptor.isChooseFiles)
    }

    private fun panel(
        choose: (JComponent) -> String? = { null },
        source: (Boolean, Boolean, String) -> SettingsPathDialogHandle = { _, _, _ -> FakeSourceDialog(null) },
        edit: (SkillDto, Boolean) -> SkillEditDialogHandle = { _, _ -> FakeSkillDialog("# Plan\nUse steps") },
    ): SkillsSettingsUi {
        install()
        val panel = edt { SkillsSettingsUi(scope!!, DIR, choose, source, edit) }
        ui = panel
        edt { panel.reload(); true }
        return panel
    }

    private fun install() {
        val cs = CoroutineScope(SupervisorJob())
        scope = cs
        appRpc = FakeAppRpcApi()
        workspaceRpc = FakeWorkspaceRpcApi()
        agentRpc = FakeAgentBehaviorRpcApi().apply {
            skills = listOf(
                SkillDto("plan", "Plan work", CUSTOM, "# Plan\nUse steps", editable = true),
                SkillDto("thinking", "Built in", "builtin", "Built in content"),
                SkillDto("remote", "Remote skill", REMOTE, "# Remote skill"),
            )
        }
        app = KiloAppService(cs, appRpc)
        val ready = KiloAppStateDto(
            KiloAppStatusDto.READY,
            config = ConfigDto(skills = SkillsConfigDto(
                paths = listOf("/global/skills"),
                urls = listOf("https://skills.test/base.json"),
            )),
        )
        app._state.value = ready
        appRpc.state.value = ready
        ApplicationManager.getApplication().replaceService(KiloAppService::class.java, app, testRootDisposable)
        ApplicationManager.getApplication().replaceService(KiloAgentBehaviorService::class.java, KiloAgentBehaviorService(cs, agentRpc), testRootDisposable)
        ApplicationManager.getApplication().replaceService(KiloWorkspaceService::class.java, KiloWorkspaceService(cs, workspaceRpc), testRootDisposable)
    }

    private fun click(list: JBList<SettingsListItem>, panel: SkillsSettingsUi, key: String, id: String) {
        edt {
            list.size = Dimension(520, 320)
            list.doLayout()
            val rows = if (list === skillsList(panel)) rows(panel) else sourceRows(panel)
            val idx = rows.indexOfFirst { it.key == key }
            list.selectedIndex = idx
            val area = settingsListCellBounds(list, idx, selected = true).getValue(id)
            click(list, center(area))
            true
        }
    }

    private fun doubleClick(list: JBList<SettingsListItem>, panel: SkillsSettingsUi, key: String) {
        edt {
            list.size = Dimension(520, 320)
            list.doLayout()
            val idx = rows(panel).indexOfFirst { it.key == key }
            list.selectedIndex = idx
            val area = list.getCellBounds(idx, idx)
            fire(list, mouse(list, MouseEvent.MOUSE_CLICKED, center(area), count = 2))
            true
        }
    }

    private fun rows(panel: SkillsSettingsUi): List<SettingsListItem> = items(skillsList(panel))

    private fun sourceRows(panel: SkillsSettingsUi): List<SettingsListItem> = items(sourceList(panel))

    private fun items(list: JBList<SettingsListItem>): List<SettingsListItem> {
        val model = list.model
        return (0 until model.size).map { model.getElementAt(it) }
    }

    private fun skillsList(panel: SkillsSettingsUi) = components(panel).filterIsInstance<JBList<SettingsListItem>>().first()

    private fun sourceList(panel: SkillsSettingsUi) = components(panel).filterIsInstance<JBList<SettingsListItem>>().last()

    private fun scrollFor(panel: SkillsSettingsUi, list: JBList<SettingsListItem>) = components(panel)
        .filterIsInstance<JBScrollPane>()
        .single { pane -> pane.viewport.view === list.parent }

    private fun progressText(panel: SkillsSettingsUi) = components(panel.progress).filterIsInstance<JBLabel>().single().text

    private fun SkillEditDialog.okText(): String {
        val method = DialogWrapper::class.java.getDeclaredMethod("getOKAction")
        method.isAccessible = true
        return (method.invoke(this) as javax.swing.Action).getValue(javax.swing.Action.NAME) as String
    }

    private fun components(root: java.awt.Component): List<java.awt.Component> {
        val out = mutableListOf<java.awt.Component>()
        fun visit(item: java.awt.Component) {
            out += item
            if (item is Container) item.components.forEach { visit(it) }
        }
        visit(root)
        return out
    }

    private fun layout(root: java.awt.Component) {
        root.doLayout()
        if (root is Container) root.components.filterIsInstance<Container>().forEach { layout(it) }
        UIUtil.dispatchAllInvocationEvents()
    }

    private fun center(rect: java.awt.Rectangle) = Point(rect.x + rect.width / 2, rect.y + rect.height / 2)

    private fun click(list: JBList<SettingsListItem>, point: Point) {
        fire(list, mouse(list, MouseEvent.MOUSE_PRESSED, point))
        fire(list, mouse(list, MouseEvent.MOUSE_RELEASED, point))
    }

    private fun mouse(list: JBList<SettingsListItem>, id: Int, point: Point, count: Int = 1) = MouseEvent(
        list,
        id,
        System.currentTimeMillis(),
        if (id == MouseEvent.MOUSE_PRESSED) InputEvent.BUTTON1_DOWN_MASK else 0,
        point.x,
        point.y,
        count,
        false,
        MouseEvent.BUTTON1,
    )

    private fun <T> edt(block: () -> T): T {
        var result: T? = null
        ApplicationManager.getApplication().invokeAndWait { result = block() }
        @Suppress("UNCHECKED_CAST")
        return result as T
    }

    private fun flushUntil(done: () -> Boolean) = runBlocking {
        repeat(300) {
            delay(10)
            edt { UIUtil.dispatchAllInvocationEvents(); true }
            if (done()) return@runBlocking
        }
        edt { UIUtil.dispatchAllInvocationEvents(); true }
        assertTrue(done())
    }

    private companion object {
        const val DIR = "/test"
        const val CUSTOM = "/home/test/.config/kilo/skill/plan/SKILL.md"
        const val REMOTE = "/home/test/.cache/kilo/skills/remote/SKILL.md"
    }
}

private class FakeSkillDialog(private val text: String, private val show: () -> Unit = {}) : SkillEditDialogHandle {
    override fun showAndGet(): Boolean {
        show()
        return true
    }
    override fun content() = text
}

private class FakeSourceDialog(private val text: String?) : SettingsPathDialogHandle {
    override fun showAndGet() = text != null
    override fun value() = text ?: ""
}
