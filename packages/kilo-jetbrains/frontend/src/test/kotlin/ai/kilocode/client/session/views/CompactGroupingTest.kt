package ai.kilocode.client.session.views

import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.model.Tool
import ai.kilocode.client.session.model.toolKind
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class CompactGroupingTest : BasePlatformTestCase() {

    override fun tearDown() {
        try {
            unsetCompactSettings()
        } finally {
            super.tearDown()
        }
    }

    fun `test read tools map to the read category`() {
        for (name in listOf("read", "glob", "grep", "find", "ls", "diagnostics")) {
            assertEquals(name, ToolGroupCategory.READ, categoryOf(tool(name)))
        }
    }

    fun `test write tools map to the write category`() {
        for (name in listOf("edit", "write", "patch", "multi_edit", "multiedit", "apply_patch")) {
            assertEquals(name, ToolGroupCategory.WRITE, categoryOf(tool(name)))
        }
    }

    // "web" is websearch/webfetch. grep and glob are reads, even though their renderers are named
    // SearchToolView and GlobToolView.
    fun `test web lookups map to the web category`() {
        assertEquals(ToolGroupCategory.WEB, categoryOf(tool("websearch")))
        assertEquals(ToolGroupCategory.WEB, categoryOf(tool("webfetch")))
    }

    fun `test task maps to the subagent category`() {
        assertEquals(ToolGroupCategory.TASK, categoryOf(tool("task")))
    }

    // The taxonomy is total: anything without a dedicated category lands in OTHER rather than
    // becoming silently ungroupable. Shell is the common case and used to fall through that gap.
    fun `test remaining tools fall into the other category`() {
        for (name in listOf("bash", "skill", "lsp", "doom_loop", "todowrite", "question", "github_create_issue")) {
            assertEquals(name, ToolGroupCategory.OTHER, categoryOf(tool(name)))
        }
    }

    fun `test nothing groups while compact mode is off`() {
        KiloPluginSettings.setCompactMode(false)
        for (name in listOf("read", "edit", "websearch", "task", "bash")) {
            assertNull(name, groupKindOf(tool(name)))
        }
    }

    fun `test compact mode groups every enabled category`() {
        KiloPluginSettings.setCompactMode(true)
        assertEquals(ToolGroupKind.MERGED, groupKindOf(tool("read")))
        assertEquals(ToolGroupKind.MERGED, groupKindOf(tool("edit")))
        assertEquals(ToolGroupKind.MERGED, groupKindOf(tool("websearch")))
        assertEquals(ToolGroupKind.MERGED, groupKindOf(tool("bash")))
        assertEquals(ToolGroupKind.SUBAGENT, groupKindOf(tool("task")))
    }

    fun `test disabling other stops shell grouping without affecting the rest`() {
        KiloPluginSettings.setCompactMode(true)
        KiloPluginSettings.setCompactGroupOther(false)

        assertNull(groupKindOf(tool("bash")))
        assertNull(groupKindOf(tool("skill")))
        assertEquals(ToolGroupKind.MERGED, groupKindOf(tool("read")))
        assertEquals(ToolGroupKind.SUBAGENT, groupKindOf(tool("task")))
    }

    fun `test a disabled category stops grouping without affecting the others`() {
        KiloPluginSettings.setCompactMode(true)
        KiloPluginSettings.setCompactGroupReads(false)
        assertNull(groupKindOf(tool("read")))
        assertEquals(ToolGroupKind.MERGED, groupKindOf(tool("edit")))

        KiloPluginSettings.setCompactGroupReads(true)
        KiloPluginSettings.setCompactGroupWrites(false)
        assertEquals(ToolGroupKind.MERGED, groupKindOf(tool("read")))
        assertNull(groupKindOf(tool("edit")))

        KiloPluginSettings.setCompactGroupWrites(true)
        KiloPluginSettings.setCompactGroupWeb(false)
        assertNull(groupKindOf(tool("webfetch")))
        assertEquals(ToolGroupKind.SUBAGENT, groupKindOf(tool("task")))

        KiloPluginSettings.setCompactGroupWeb(true)
        KiloPluginSettings.setCompactGroupSubagents(false)
        assertNull(groupKindOf(tool("task")))
        assertEquals(ToolGroupKind.MERGED, groupKindOf(tool("read")))
    }

    fun `test defaults leave compact off with every category enabled`() {
        unsetCompactSettings()
        assertFalse(KiloPluginSettings.getCompactMode())
        assertTrue(KiloPluginSettings.getCompactGroupReads())
        assertTrue(KiloPluginSettings.getCompactGroupWrites())
        assertTrue(KiloPluginSettings.getCompactGroupWeb())
        assertTrue(KiloPluginSettings.getCompactGroupOther())
        assertTrue(KiloPluginSettings.getCompactGroupSubagents())
    }

    private fun tool(name: String) = Tool("t-$name", name, toolKind(name))
}

internal fun unsetCompactSettings() {
    KiloPluginSettings.unsetCompactMode()
    KiloPluginSettings.unsetCompactGroupReads()
    KiloPluginSettings.unsetCompactGroupWrites()
    KiloPluginSettings.unsetCompactGroupWeb()
    KiloPluginSettings.unsetCompactGroupOther()
    KiloPluginSettings.unsetCompactGroupSubagents()
}
