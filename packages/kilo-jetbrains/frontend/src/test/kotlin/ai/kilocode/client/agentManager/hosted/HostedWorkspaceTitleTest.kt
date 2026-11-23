package ai.kilocode.client.agentManager.hosted

import ai.kilocode.rpc.dto.HostedIDs
import ai.kilocode.rpc.dto.HostedWorkspaceDto
import ai.kilocode.rpc.dto.HostedWorkspaceRefDto
import ai.kilocode.rpc.dto.HostedWorkspaceSessionDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class HostedWorkspaceTitleTest : BasePlatformTestCase() {
    private val ref = HostedWorkspaceRefDto("cloud", "worktree_5b3fe886-e71a-467c-8d5e-69448401e07")

    fun `test latest non-default session title wins everywhere`() {
        val dto = HostedWorkspaceDto(
            ref,
            name = "Workspace name",
            branch = "kilo/branch",
            sessions = listOf(
                session("old", "Old title", 1.0),
                session("latest", "OpenAI information request", 2.0),
            ),
        )
        assertEquals("OpenAI information request", HostedWorkspaceTitle.text(dto))
    }

    fun `test generated default session title falls back to the workspace name`() {
        val dto = HostedWorkspaceDto(
            ref,
            name = "Cloud custom name",
            branch = "kilo/branch",
            sessions = listOf(session("root", "New session - 2026-07-30T19:01:40.945Z", 1.0)),
        )
        assertEquals("Cloud custom name", HostedWorkspaceTitle.text(dto))
    }

    fun `test generated cloud workspace name is hidden`() {
        val dto = HostedWorkspaceDto(ref, name = ref.workspaceID, branch = "kilo/branch")
        assertEquals("kilo/branch", HostedWorkspaceTitle.text(dto))
    }

    fun `test branch then workspace id are the last fallbacks`() {
        assertEquals("kilo/branch", HostedWorkspaceTitle.text(null, "kilo/branch", ref.workspaceID))
        assertEquals(ref.workspaceID, HostedWorkspaceTitle.text(null, null, ref.workspaceID))
    }

    private fun session(id: String, title: String, updated: Double) = HostedWorkspaceSessionDto(
        id = HostedIDs.session(ref.providerID, ref.workspaceID, id),
        nativeSessionID = id,
        title = title,
        updated = updated,
    )
}