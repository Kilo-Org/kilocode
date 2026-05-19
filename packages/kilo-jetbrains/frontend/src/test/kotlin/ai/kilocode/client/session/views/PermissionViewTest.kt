package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Permission
import ai.kilocode.client.session.model.PermissionMeta
import ai.kilocode.rpc.dto.PermissionReplyDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.awt.Container
import javax.swing.AbstractButton

@Suppress("UnstableApiUsage")
class PermissionViewTest : BasePlatformTestCase() {

    private val replies = mutableListOf<Pair<String, PermissionReplyDto>>()
    private lateinit var view: PermissionView

    override fun setUp() {
        super.setUp()
        view = PermissionView(
            reply = { id, dto -> replies.add(id to dto) },
        )
    }

    fun `test allow button uses bundle text and replies once`() {
        view.show(permission())

        buttons(view).first { it.text == "Allow" }.doClick()

        assertFalse(view.isVisible)
        assertEquals(1, replies.size)
        assertEquals("perm1", replies.single().first)
        assertEquals("once", replies.single().second.reply)
    }

    fun `test deny button uses bundle text and rejects`() {
        view.show(permission())

        buttons(view).first { it.text == "Deny" }.doClick()

        assertFalse(view.isVisible)
        assertEquals(1, replies.size)
        assertEquals("perm1", replies.single().first)
        assertEquals("reject", replies.single().second.reply)
    }

    fun `test blank patterns display star`() {
        view.show(
            Permission(
                id = "perm2",
                sessionId = "ses",
                name = "edit",
                patterns = emptyList(),
                always = emptyList(),
                meta = PermissionMeta(),
            )
        )

        assertTrue(view.isVisible)
    }

    private fun permission() = Permission(
        id = "perm1",
        sessionId = "ses_test",
        name = "edit",
        patterns = listOf("*.kt"),
        always = emptyList(),
        meta = PermissionMeta(),
        message = "Review file changes",
    )

    private fun buttons(root: Container): List<AbstractButton> = root.components.flatMap { comp ->
        val item = if (comp is AbstractButton) listOf(comp) else emptyList()
        if (comp is Container) item + buttons(comp) else item
    }
}
