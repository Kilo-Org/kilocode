package ai.kilocode.client.session.context

import ai.kilocode.client.plugin.KiloPluginSettings
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.util.SystemInfo
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.EnvironmentUtil
import com.intellij.util.ui.UIUtil

class EditorContextGathererTest : BasePlatformTestCase() {
    override fun tearDown() {
        try {
            KiloPluginSettings.unsetAutoEditorContext()
        } finally {
            super.tearDown()
        }
    }

    fun `test gather includes active open visible files and selected range`() {
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

        val result = EditorContextGatherer.gather(project, root)

        assertEquals("src/App.kt", result.context?.activeFile)
        assertEquals(listOf("src/App.kt"), result.context?.openTabs)
        assertEquals(listOf("src/App.kt"), result.context?.visibleFiles)
        assertEquals("text/plain", result.selection?.mime)
        assertEquals("App.kt", result.selection?.filename)
        assertTrue(result.selection?.url, result.selection?.url.orEmpty().contains("/src/App.kt?start=2&end=3"))
        val expectedShell = if (SystemInfo.isWindows) EnvironmentUtil.getValue("COMSPEC") else EnvironmentUtil.getValue("SHELL")
        assertEquals(expectedShell, result.context?.shell)
    }

    fun `test gather filters kilocodeignore files from open tabs`() {
        val app = myFixture.addFileToProject("src/App.kt", "fun main() {}")
        val secret = myFixture.addFileToProject("ignored/Secret.kt", "val token = 1")
        myFixture.addFileToProject(".kilocodeignore", "ignored/\n")
        val manager = FileEditorManager.getInstance(project)
        manager.openFile(secret.virtualFile, true)
        manager.openFile(app.virtualFile, true)
        UIUtil.dispatchAllInvocationEvents()
        val root = app.virtualFile.parent.parent.path

        val result = EditorContextGatherer.gather(project, root)

        assertEquals("src/App.kt", result.context?.activeFile)
        assertEquals(listOf("src/App.kt"), result.context?.openTabs)
        assertEquals(listOf("src/App.kt"), result.context?.visibleFiles)
    }

    fun `test gather drops selection when active file is ignored`() {
        val secret = myFixture.addFileToProject("ignored/Secret.kt", "val token = 1\nval other = 2\n")
        myFixture.addFileToProject(".kilocodeignore", "ignored/\n")
        val manager = FileEditorManager.getInstance(project)
        manager.openFile(secret.virtualFile, true)
        UIUtil.dispatchAllInvocationEvents()
        val editor = manager.selectedTextEditor!!
        val doc = editor.document
        editor.selectionModel.setSelection(doc.getLineStartOffset(0), doc.getLineEndOffset(0))
        val root = secret.virtualFile.parent.parent.path

        val result = EditorContextGatherer.gather(project, root)

        assertNull(result.context?.activeFile)
        assertNull(result.context?.openTabs)
        assertNull(result.context?.visibleFiles)
        assertNull(result.selection)
    }

    fun `test gather returns empty when setting is off`() {
        KiloPluginSettings.setAutoEditorContext(false)
        val psi = myFixture.addFileToProject("src/App.kt", "fun main() {}")
        FileEditorManager.getInstance(project).openFile(psi.virtualFile, true)
        UIUtil.dispatchAllInvocationEvents()

        val result = EditorContextGatherer.gather(project, psi.virtualFile.parent.parent.path)

        assertNull(result.context)
        assertNull(result.selection)
    }
}
