package ai.kilocode.client.fs

import junit.framework.TestCase

class KiloEditorTargetTest : TestCase() {

    fun `test profile target has stable path and url`() {
        assertEquals("profile", KiloEditorTarget.Profile.path)
        assertEquals("Kilo Profile", KiloEditorTarget.Profile.title)
        assertEquals("kilo://profile", KiloEditorTarget.Profile.url)
    }

    fun `test parse profile path`() {
        assertSame(KiloEditorTarget.Profile, KiloEditorTarget.parse("profile"))
        assertSame(KiloEditorTarget.Profile, KiloEditorTarget.parse("/profile"))
    }

    fun `test reject unknown path`() {
        assertNull(KiloEditorTarget.parse("account"))
        assertNull(KiloEditorTarget.parse("settings"))
        assertNull(KiloEditorTarget.parse("worktree/foo/agent-manager"))
        assertNull(KiloEditorTarget.parse(""))
    }
}
