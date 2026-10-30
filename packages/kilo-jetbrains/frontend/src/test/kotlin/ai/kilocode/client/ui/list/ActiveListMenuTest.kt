package ai.kilocode.client.ui.list

import ai.kilocode.client.agentManager.hosted.HostedWorkspaceDataKeys
import ai.kilocode.client.agentManager.hosted.HostedWorkspaceRow
import ai.kilocode.client.agentManager.hosted.HostedWorkspaceRowData
import ai.kilocode.client.agentManager.worktree.WorktreeDataKeys
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.WorktreeDto
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.actionSystem.impl.SimpleDataContext
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import javax.swing.JPanel

class ActiveListMenuTest : BasePlatformTestCase() {
    fun `test local and cloud popup contexts contain only their own typed workspace`() {
        val dto = WorktreeDto("local", "/repo/local", "Local", "main", false)
        val local = object : ActiveListItem {
            override val key = dto.id
            override val title = dto.name
            override val search = dto.name
        }
        val hosted = HostedWorkspaceDto(HostedWorkspaceRefDto("cloud", "one"))
        val cloud = HostedWorkspaceRow(HostedWorkspaceRowData(hosted, null))
        val group = DefaultActionGroup()
        val menu = ActiveListMenu(WorktreeDataKeys.WORKTREE, group, element = { row -> dto.takeIf { row === local } },
            alternate = ActiveListMenu(HostedWorkspaceDataKeys.WORKSPACE, group, element = { row ->
                (row as? HostedWorkspaceRow)?.data?.dto
            }))
        val anchor = JPanel()
        assertTrue(menu.available(local))
        assertTrue(menu.available(cloud))
        val one = menu.context(anchor, local)
        assertTrue(one is SimpleDataContext)
        assertSame(dto, WorktreeDataKeys.WORKTREE.getData(one))
        assertNull(HostedWorkspaceDataKeys.WORKSPACE.getData(one))
        val two = menu.context(anchor, cloud)
        assertTrue(two is SimpleDataContext)
        assertSame(hosted, HostedWorkspaceDataKeys.WORKSPACE.getData(two))
        assertNull(WorktreeDataKeys.WORKTREE.getData(two))
    }
}
