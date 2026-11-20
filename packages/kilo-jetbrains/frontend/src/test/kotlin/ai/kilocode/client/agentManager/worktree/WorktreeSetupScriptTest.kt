package ai.kilocode.client.agentManager.worktree

import ai.kilocode.rpc.dto.SetupScriptKind
import ai.kilocode.rpc.dto.SetupScriptTargetDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class WorktreeSetupScriptTest : BasePlatformTestCase() {
    fun `test posix command invokes sh with a quoted path`() {
        val script = SetupScriptTargetDto("/repo/.kilo2/setup-script", "/repo/.kilo2/setup-script", true, SetupScriptKind.POSIX)

        assertEquals("sh '/repo/.kilo2/setup-script'", setupScriptCommand(script))
    }

    fun `test powershell command uses NoProfile and Bypass with a quoted path`() {
        val script = SetupScriptTargetDto("C:\\repo\\.kilo2\\setup-script.ps1", "C:\\repo\\.kilo2\\setup-script.ps1", true, SetupScriptKind.POWERSHELL)

        assertEquals(
            "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File \"C:\\repo\\.kilo2\\setup-script.ps1\"",
            setupScriptCommand(script),
        )
    }

    fun `test cmd command uses d s c with a quoted path`() {
        val script = SetupScriptTargetDto("C:\\repo\\.kilo2\\setup-script.cmd", "C:\\repo\\.kilo2\\setup-script.cmd", true, SetupScriptKind.CMD)

        assertEquals("cmd.exe /d /s /c \"C:\\repo\\.kilo2\\setup-script.cmd\"", setupScriptCommand(script))
    }

    fun `test posix quoting escapes an embedded single quote`() {
        val script = SetupScriptTargetDto("/repo/it's/.kilo2/setup-script", "/repo/it's/.kilo2/setup-script", true, SetupScriptKind.POSIX)

        assertEquals("sh '/repo/it'\\''s/.kilo2/setup-script'", setupScriptCommand(script))
    }

    fun `test windows quoting doubles an embedded double quote`() {
        val script = SetupScriptTargetDto("C:\\repo \"copy\"\\.kilo2\\setup-script.ps1", "", true, SetupScriptKind.POWERSHELL)

        assertEquals(
            "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File \"C:\\repo \"\"copy\"\"\\.kilo2\\setup-script.ps1\"",
            setupScriptCommand(script),
        )
    }

    fun `test posix quoting handles a path containing spaces`() {
        val script = SetupScriptTargetDto("/repo/my worktree/.kilo2/setup-script", "", true, SetupScriptKind.POSIX)

        assertEquals("sh '/repo/my worktree/.kilo2/setup-script'", setupScriptCommand(script))
    }
}
