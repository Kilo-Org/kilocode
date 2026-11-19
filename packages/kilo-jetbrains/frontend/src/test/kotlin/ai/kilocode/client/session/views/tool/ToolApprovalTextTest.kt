package ai.kilocode.client.session.views.tool

import ai.kilocode.client.session.model.ToolApproval
import com.intellij.testFramework.fixtures.BasePlatformTestCase

@Suppress("UnstableApiUsage")
class ToolApprovalTextTest : BasePlatformTestCase() {
    fun `test global approval includes source and rule`() {
        val note = describeToolApproval(ToolApproval(
            source = "global",
            rulePermission = "bash",
            rulePattern = "pwd",
            ruleAction = "allow",
        ))

        assertEquals("Auto-approved by your global config matched `bash` rule `pwd`", note?.text)
    }

    fun `test manual approval uses manual decision`() {
        val note = describeToolApproval(ToolApproval(source = "manual"))

        assertEquals("Approved by you", note?.text)
    }

    fun `test agent approval includes agent name`() {
        val note = describeToolApproval(ToolApproval(source = "agent", agent = "build"))

        assertEquals("Auto-approved by the build agent", note?.text)
    }

    fun `test catch all rule is hidden`() {
        val note = describeToolApproval(ToolApproval(
            source = "session",
            rulePermission = "*",
            rulePattern = "*",
            ruleAction = "allow",
        ))

        assertEquals("Auto-approved by a session auto-approve rule", note?.text)
    }

    fun `test outside workspace shows path tail`() {
        val note = describeToolApproval(ToolApproval(
            source = "project",
            outsideWorkspace = true,
            outsideWorkspacePath = "/tmp/outside",
        ))

        assertEquals("Auto-approved by the project config (outside your workspace: outside)", note?.text)
    }
}
