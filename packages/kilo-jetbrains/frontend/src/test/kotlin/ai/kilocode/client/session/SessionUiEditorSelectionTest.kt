package ai.kilocode.client.session

import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.controller.PromptSelection
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.PromptPartDto
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.util.ui.UIUtil

/**
 * Exercises the real [SessionUi.sendPrompt] path (private, invoked via reflection like
 * [SessionUiTestBase.controller]) to prove the outbound part order: the user's typed text, any
 * explicit attachments, then the selection-grounding marker immediately before its ranged file
 * attachment. See [ai.kilocode.client.session.context.EditorContextGathererTest] for the marker's
 * own content assertions.
 */
class SessionUiEditorSelectionTest : SessionUiTestBase() {
    override fun tearDown() {
        try {
            KiloPluginSettings.unsetAutoEditorContext()
        } finally {
            super.tearDown()
        }
    }

    fun `test sendPrompt places the selection marker after explicit attachments`() {
        val psi = myFixture.addFileToProject(
            "src/App.kt",
            "fun main() {\n    println(\"hi\")\n    println(\"bye\")\n}\n",
        )
        val manager = FileEditorManager.getInstance(project)
        manager.openFile(psi.virtualFile, true)
        UIUtil.dispatchAllInvocationEvents()
        val editor = manager.selectedTextEditor!!
        val doc = editor.document
        editor.selectionModel.setSelection(doc.getLineStartOffset(1), doc.getLineEndOffset(2))
        val root = psi.virtualFile.parent.parent.path

        // Reassigns [ui] without disposing the previous instance first: SessionController.dispose()
        // cancels the shared coroutine [scope] (see SessionScrollTest.dock() for the same pattern),
        // which would kill every later coroutine including this replacement UI's own prompt dispatch.
        workspace = workspaces.workspace(root)
        ui = newUi()
        layout()
        settle()

        val attachment = PromptPartDto(
            type = "file",
            mime = "text/plain",
            url = "file:///other.kt",
            filename = "other.kt",
        )
        val method = SessionUi::class.java.getDeclaredMethod(
            "sendPrompt",
            String::class.java,
            List::class.java,
            PromptSelection::class.java,
        )
        method.isAccessible = true
        edtWait { method.invoke(ui, "Explain this selection", listOf(attachment), null) }
        settle()

        val parts = rpc.prompts.single().third.parts
        assertEquals(4, parts.size)
        assertEquals("text", parts[0].type)
        assertEquals("Explain this selection", parts[0].text)
        assertEquals(attachment, parts[1])
        assertEquals("text", parts[2].type)
        assertEquals(true, parts[2].synthetic)
        assertTrue(parts[2].text, parts[2].text.orEmpty().contains("lines 2-3"))
        assertEquals("file", parts[3].type)
        assertNull(parts[3].synthetic)
        assertTrue(parts[3].url, parts[3].url.orEmpty().contains("/src/App.kt?start=2&end=3"))
    }
}
