package ai.kilocode.client.session

import ai.kilocode.client.plugin.KiloPluginSettings
import ai.kilocode.client.session.controller.PromptSelection
import ai.kilocode.client.util.edtWait
import ai.kilocode.rpc.dto.PromptPartDto
import ai.kilocode.rpc.dto.WorkspaceFileDto
import ai.kilocode.client.session.ui.prompt.PromptPanel
import ai.kilocode.client.session.ui.header.SessionHeaderPanel
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
    fun `test hosted send skips editor context selected files and reasoning`() {
        KiloPluginSettings.setAutoEditorContext(true)
        val psi = myFixture.addFileToProject("src/Selected.kt", "one\ntwo\nthree\n")
        val editors = FileEditorManager.getInstance(project)
        editors.openFile(psi.virtualFile, true)
        UIUtil.dispatchAllInvocationEvents()
        editors.selectedTextEditor!!.selectionModel.setSelection(4, 8)
        workspace = workspaces.workspace(psi.virtualFile.parent.parent.path)
        val manager = object : SessionManager {
            override val hosted = true
            override val showsBranchDock = false
            override fun newSession() = Unit
            override fun showHistory(back: (() -> Unit)?) = Unit
            override fun openSession(ref: SessionRef) = Unit
        }
        ui = newUi("hosted:kilo-cloud:worktree_1:ses_one", manager = manager)
        layout()
        settle()
        val panel = find(ui, PromptPanel::class.java)!!
        panel.setText("Continue the task")
        panel.send()
        assertTrue(pumpUntil { rpc.prompts.size == 1 })
        val sent = rpc.prompts.single()
        assertEquals("hosted:kilo-cloud:worktree_1:ses_one", sent.first)
        assertEquals(listOf("text"), sent.third.parts.map { it.type })
        assertEquals("Continue the task", sent.third.parts.single().text)
        assertNull(sent.third.editorContext)
        assertNull(sent.third.variant)
        assertNull(sent.third.noReply)
        assertFalse(panel.reasoning.isVisible)
        assertFalse(panel.reasoning.canCycle())
        val header = find(ui, SessionHeaderPanel::class.java)!!
        assertFalse(header.compactButton().isVisible)
        val send = SessionUi::class.java.getDeclaredMethod(
            "sendPrompt",
            String::class.java,
            List::class.java,
            PromptSelection::class.java,
        ).apply { isAccessible = true }
        fun submit(text: String) = edtWait { send.invoke(ui, text, emptyList<PromptPartDto>(), null) }
        workspaceRpc.fileResolver = { path ->
            listOf(WorkspaceFileDto(path, path.substringAfterLast('/'))).takeIf { path == "Selected.kt" }.orEmpty()
        }
        submit("Check @Override and ping @handle")
        assertTrue(pumpUntil { rpc.prompts.size == 2 })
        assertEquals("Check @Override and ping @handle", rpc.prompts.last().third.parts.single().text)
        panel.setText("Check @Selected.kt")
        submit("Check @Selected.kt")
        settle()
        assertEquals("Mention must not dispatch silently without its content", 2, rpc.prompts.size)
        assertEquals("Check @Selected.kt", panel.text())
        panel.setText("Review @git-changes")
        submit("Review @git-changes")
        settle()
        assertEquals("Reserved file actions must not dispatch without their content", 2, rpc.prompts.size)
        assertEquals("Review @git-changes", panel.text())
    }

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
        assertTrue("prompt was not dispatched", pumpUntil { rpc.prompts.isNotEmpty() })

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
