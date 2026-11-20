package ai.kilocode.client.session.ui.prompt

import ai.kilocode.client.app.KiloWorkspaceService
import ai.kilocode.client.plugin.KiloBundle
import ai.kilocode.client.testing.FakeWorkspaceRpcApi
import ai.kilocode.rpc.dto.WorkspaceFileDto
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.event.EditorMouseEvent
import com.intellij.openapi.editor.event.EditorMouseEventArea
import com.intellij.openapi.editor.ex.EditorEx
import com.intellij.openapi.editor.markup.HighlighterLayer
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import java.awt.event.InputEvent
import java.awt.event.MouseEvent
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.fail

@Suppress("UnstableApiUsage")
class MentionNavigatorTest : BasePlatformTestCase() {
    // "see @src/a.ts and @missing.ts" — resolved token spans 4..13, unresolved spans 18..29.
    private val text = "see @src/a.ts and @missing.ts"

    private lateinit var scope: CoroutineScope
    private lateinit var rpc: FakeWorkspaceRpcApi
    private lateinit var provider: KiloPromptCompletionProvider
    private lateinit var editor: EditorEx
    private lateinit var navigator: MentionNavigator

    override fun setUp() {
        super.setUp()
        scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        rpc = FakeWorkspaceRpcApi()
        rpc.fileResolver = { path -> if (path == "src/a.ts") listOf(file(path)) else emptyList() }
        val workspaces = KiloWorkspaceService(scope, rpc)
        provider = KiloPromptCompletionProvider(
            workspace = workspaces.workspace("/test"),
            service = workspaces,
            actions = emptyList(),
            mentions = emptyList(),
            scope = scope,
        )
        val factory = EditorFactory.getInstance()
        editor = factory.createEditor(factory.createDocument(text), project) as EditorEx
        navigator = MentionNavigator(editor, provider)
        navigator.install()
        val resolved = CountDownLatch(2)
        provider.validate(text, -1) { resolved.countDown() }
        assertTrue("mention validation did not complete", resolved.await(5, TimeUnit.SECONDS))
        // LLM note: the callback can fire before cross-thread mention state is observable to mouse-event assertions.
        waitFor {
            provider.mentionAt(text, 6)?.resolved == true &&
                provider.mentionAt(text, 20)?.resolved == false
        }
    }

    override fun tearDown() {
        try {
            EditorFactory.getInstance().releaseEditor(editor)
            scope.cancel()
        } finally {
            super.tearDown()
        }
    }

    fun `test hovering unresolved mention sets tooltip`() {
        navigator.mouseMoved(event(20))

        assertEquals(KiloBundle.message("prompt.mention.unresolved", "missing.ts"), editor.contentComponent.toolTipText)
    }

    fun `test leaving mention clears tooltip`() {
        navigator.mouseMoved(event(20))
        navigator.mouseMoved(event(1))

        assertNull(editor.contentComponent.toolTipText)
    }

    fun `test modifier hover highlights resolved mention as link`() {
        navigator.mouseMoved(event(6, modifier = true))
        assertTrue(editor.markupModel.allHighlighters.any { it.layer == HighlighterLayer.HYPERLINK })

        navigator.mouseMoved(event(6, modifier = false))
        assertFalse(editor.markupModel.allHighlighters.any { it.layer == HighlighterLayer.HYPERLINK })
    }

    fun `test modifier click opens resolved mention`() {
        navigator.mouseClicked(event(6, modifier = true))
        waitFor { rpc.opened.contains("src/a.ts") }

        assertTrue(rpc.opened.contains("src/a.ts"))
    }

    private fun event(offset: Int, modifier: Boolean = false): EditorMouseEvent {
        val mask = if (modifier) InputEvent.META_DOWN_MASK or InputEvent.CTRL_DOWN_MASK else 0
        val point = editor.offsetToXY(offset)
        val mouse = MouseEvent(editor.contentComponent, MouseEvent.MOUSE_MOVED, 0L, mask, point.x, point.y, 1, false)
        return EditorMouseEvent(
            editor,
            mouse,
            EditorMouseEventArea.EDITING_AREA,
            offset,
            editor.offsetToLogicalPosition(offset),
            editor.offsetToVisualPosition(offset),
            true,
            null,
            null,
            null,
        )
    }

    private fun file(path: String) = WorkspaceFileDto(path = path, name = path.substringAfterLast('/'))

    private fun waitFor(done: () -> Boolean) {
        repeat(250) {
            UIUtil.dispatchAllInvocationEvents()
            if (done()) return
            Thread.sleep(20)
        }
        fail("condition was not met")
    }
}
