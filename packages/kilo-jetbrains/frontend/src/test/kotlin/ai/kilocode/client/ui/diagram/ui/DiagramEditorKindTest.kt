package ai.kilocode.client.ui.diagram.ui

import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.session.ui.attachment.AttachmentEditorKind
import ai.kilocode.client.session.ui.attachment.ensureAttachmentEditorKind
import ai.kilocode.client.ui.CodeViewField
import ai.kilocode.client.util.edtWait
import ai.kilocode.client.vfs.KiloEditorKindRegistry
import ai.kilocode.client.vfs.KiloFileEditorProvider
import ai.kilocode.client.vfs.KiloPath
import ai.kilocode.client.vfs.KiloSourceEditorProvider
import ai.kilocode.client.vfs.KiloVfsManager
import ai.kilocode.client.vfs.KiloVirtualFile
import ai.kilocode.client.vfs.KiloVirtualFileSystem
import com.intellij.openapi.application.runReadActionBlocking
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.Component
import java.awt.Container

/**
 * The bottom Diagram/Source tab strip itself cannot be asserted here: unit tests run against
 * `TestEditorManagerImpl`, which builds a single editor per file and honours
 * `FileEditorProvider.KEY`. These tests cover the pieces the platform composes instead — which
 * providers accept the file, and what each provider builds.
 */
class DiagramEditorKindTest : BasePlatformTestCase() {
    private val flow = "flowchart TD\nA-->B\n"

    override fun setUp() {
        super.setUp()
        ensureDiagramEditorKind()
    }

    override fun tearDown() {
        try {
            unregisterDiagramEditorKind()
            KiloVirtualFileSystem.getInstance().clear()
        } finally {
            super.tearDown()
        }
    }

    fun `test opening the same source reuses one tab and a different source opens another`() {
        val vfs = project.service<KiloVfsManager>()
        val manager = FileEditorManager.getInstance(project)

        edtWait { assertTrue(vfs.open(DiagramEditorKind.ID, params(flow))) }
        edtWait { assertTrue(vfs.open(DiagramEditorKind.ID, params(flow))) }

        val files = manager.openFiles.filterIsInstance<KiloVirtualFile>()
        assertEquals(1, files.size)
        assertEquals(DiagramEditorKind.ID, files.single().path.kind)

        edtWait { assertTrue(vfs.open(DiagramEditorKind.ID, params("flowchart TD\nA-->C\n"))) }

        assertEquals(2, manager.openFiles.filterIsInstance<KiloVirtualFile>().size)
    }

    fun `test the platform builds no document for a diagram file`() {
        // A text file type would make FileDocumentManager load text while EditorComposite is built,
        // and KiloVirtualFile has no content to give.
        val diagram = file(params(flow))

        assertNull(runReadActionBlocking { FileDocumentManager.getInstance().getDocument(diagram) })
        assertTrue(diagram.fileType.isBinary)
    }

    fun `test kind is invalid once the source is unknown`() {
        assertTrue(DiagramEditorKind.isValid(params(flow)))
        assertFalse(DiagramEditorKind.isValid(mapOf("token" to "deadbeef")))
        assertFalse(DiagramEditorKind.isValid(emptyMap()))
    }

    fun `test both providers accept a diagram file and only the diagram kind offers a source view`() {
        ensureAttachmentEditorKind()
        val diagram = file(params(flow))
        val attachment = KiloVirtualFile(KiloPath(AttachmentEditorKind.ID, mapOf("partId" to "prt1")))

        assertTrue(KiloFileEditorProvider().accept(project, diagram))
        assertTrue(KiloSourceEditorProvider().accept(project, diagram))
        assertTrue(KiloFileEditorProvider().accept(project, attachment))
        assertFalse(KiloSourceEditorProvider().accept(project, attachment))
    }

    fun `test both providers hide other editors so the platform keeps them side by side`() {
        // FileEditorProviderManagerImpl drops every provider whose policy is not HIDE_OTHER_EDITORS
        // as soon as one provider requests it, so both kilo providers must agree.
        assertEquals(FileEditorPolicy.HIDE_OTHER_EDITORS, KiloFileEditorProvider().policy)
        assertEquals(FileEditorPolicy.HIDE_OTHER_EDITORS, KiloSourceEditorProvider().policy)
    }

    fun `test diagram and source views build named editors and release their editor`() {
        val base = EditorFactory.getInstance().allEditors.size
        val diagram = file(params(flow))

        edtWait {
            val main = KiloFileEditorProvider().createEditor(project, diagram)
            val source = KiloSourceEditorProvider().createEditor(project, diagram)
            try {
                assertEquals(KiloBundle.message("diagram.title"), main.name)
                assertEquals(KiloBundle.message("diagram.source"), source.name)
                // The tab hosts the same zoomable viewer the diagram window uses.
                assertEquals(1, descendants(main.component).filterIsInstance<DiagramViewer>().size)

                val field = descendants(source.component).filterIsInstance<CodeViewField>().single()
                assertEquals(flow.trim(), field.text.trim())
                assertTrue(field.isViewer)
            } finally {
                Disposer.dispose(main)
                Disposer.dispose(source)
            }
        }

        assertEquals(base, EditorFactory.getInstance().allEditors.size)
    }

    private fun params(source: String) = mapOf("token" to service<DiagramStore>().put(source))

    private fun file(params: Map<String, String>) = KiloVirtualFile(KiloPath(DiagramEditorKind.ID, params))

    private fun descendants(root: Container): List<Component> {
        val out = mutableListOf<Component>()
        for (comp in root.components) {
            out.add(comp)
            if (comp is Container) out.addAll(descendants(comp))
        }
        return out
    }
}
