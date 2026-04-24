package ai.kilocode.client.session

import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.client.session.model.SessionState
import ai.kilocode.client.session.ui.SessionPanel
import ai.kilocode.client.session.views.TextView
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.MessageWithPartsDto
import ai.kilocode.rpc.dto.PartDto
import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/**
 * Integration test: mutate [SessionModel] directly on the EDT and verify
 * that [SessionPanel] reflects the changes without any end-to-end RPC flow.
 *
 * This tests the full model → event → view update pipeline in isolation.
 */
@Suppress("UnstableApiUsage")
class SessionUiUpdateTest : BasePlatformTestCase() {

    private lateinit var model: SessionModel
    private lateinit var parent: Disposable
    private lateinit var panel: SessionPanel

    override fun setUp() {
        super.setUp()
        parent = Disposer.newDisposable("test")
        model = SessionModel()
        panel = SessionPanel(model, parent)
    }

    override fun tearDown() {
        try {
            Disposer.dispose(parent)
        } finally {
            super.tearDown()
        }
    }

    // ------ streaming text ------

    fun `test streaming text delta is reflected in panel`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", part("p1", "a1", "text", text = "hello "))
        model.appendDelta("a1", "p1", "world")

        val tv = panel.findMessage("a1")!!.part("p1") as TextView
        assertEquals("hello world", tv.markdown())
    }

    fun `test multiple deltas build up content correctly`() {
        model.upsertMessage(msg("a1", "assistant"))
        for (token in listOf("**T", "ok", "en**", " stream")) {
            model.appendDelta("a1", "p1", token)
        }

        val tv = panel.findMessage("a1")!!.part("p1") as TextView
        assertEquals("**Token** stream", tv.markdown())
        assertTrue(tv.md.html().contains("<strong>"))
    }

    // ------ full message lifecycle ------

    fun `test message added then parts then message updated`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", part("p1", "a1", "text", text = "initial"))

        // Second MessageUpdated (e.g. token/cost meta) should not lose parts
        model.upsertMessage(msg("a1", "assistant"))

        val mv = panel.findMessage("a1")!!
        assertEquals(listOf("p1"), mv.partIds())
    }

    // ------ tool lifecycle ------

    fun `test tool state transitions are reflected in ToolView`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", toolPart("t1", "a1", "bash", "pending"))
        model.updateContent("a1", toolPart("t1", "a1", "bash", "running"))
        model.updateContent("a1", toolPart("t1", "a1", "bash", "completed"))

        val tv = panel.findMessage("a1")!!.part("t1") as ai.kilocode.client.session.views.ToolView
        assertTrue(tv.labelText().contains("\u2713"))  // ✓ completed
    }

    // ------ multiple turns update correctly ------

    fun `test content goes to correct turn when multiple turns exist`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        model.upsertMessage(msg("u2", "user"))
        model.upsertMessage(msg("a2", "assistant"))

        model.updateContent("a1", part("p1", "a1", "text", text = "turn1"))
        model.updateContent("a2", part("p2", "a2", "text", text = "turn2"))

        val t1text = (panel.findMessage("a1")!!.part("p1") as TextView).markdown()
        val t2text = (panel.findMessage("a2")!!.part("p2") as TextView).markdown()

        assertEquals("turn1", t1text)
        assertEquals("turn2", t2text)
    }

    // ------ compaction marker ------

    fun `test compaction part appears in panel`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", PartDto("cp1", "ses", "a1", "compaction"))

        val mv = panel.findMessage("a1")!!
        assertEquals(listOf("cp1"), mv.partIds())
        assertTrue(mv.part("cp1") is ai.kilocode.client.session.views.CompactionView)
    }

    // ------ generic fallback ------

    fun `test unknown part type falls back to GenericView`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", PartDto("g1", "ses", "a1", "snapshot"))

        val mv = panel.findMessage("a1")!!
        val gv = mv.part("g1")
        assertNotNull(gv)
        assertTrue(gv is ai.kilocode.client.session.views.GenericView)
        assertTrue((gv as ai.kilocode.client.session.views.GenericView).labelText().contains("snapshot"))
    }

    // ------ silent part types ------

    fun `test step-start part is not rendered in panel`() {
        model.upsertMessage(msg("a1", "assistant"))
        model.updateContent("a1", PartDto("g1", "ses", "a1", "step-start"))
        model.updateContent("a1", PartDto("g2", "ses", "a1", "step-finish"))

        val mv = panel.findMessage("a1")!!
        assertTrue(mv.partIds().isEmpty())
    }

    // ------ history load ------

    fun `test loadHistory populates panel with correct turn structure and content`() {
        model.loadHistory(listOf(
            MessageWithPartsDto(
                msg("u1", "user"),
                listOf(part("pu1", "u1", "text", text = "can you help")),
            ),
            MessageWithPartsDto(
                msg("a1", "assistant"),
                listOf(part("pa1", "a1", "text", text = "sure")),
            ),
        ))

        assertEquals(1, panel.turnCount())
        assertEquals("turn#u1: user#u1, assistant#a1", panel.dump())

        val userText = (panel.findMessage("u1")!!.part("pu1") as TextView).markdown()
        val assistantText = (panel.findMessage("a1")!!.part("pa1") as TextView).markdown()
        assertEquals("can you help", userText)
        assertEquals("sure", assistantText)
    }

    // ------ regrouping triggered by remove ------

    fun `test removing user anchor updates panel structure`() {
        model.upsertMessage(msg("u1", "user"))
        model.upsertMessage(msg("a1", "assistant"))
        model.upsertMessage(msg("u2", "user"))

        model.removeMessage("u1")

        // a1 now forms its own standalone turn; u2 still has its own
        assertEquals(2, panel.turnCount())
        assertNotNull(panel.findMessage("a1"))
        assertEquals("turn#a1: assistant#a1", panel.findTurn("a1")?.let { "turn#${it.id}: ${it.dump()}" })
    }

    // ------ idle state hides docks ------

    fun `test StateChanged to Idle is handled without crash`() {
        model.setState(SessionState.Busy("thinking"))
        model.setState(SessionState.Idle)
        // SessionPanel itself does not render state — just ensure no exception
        assertTrue(true)
    }

    // ------ helpers ------

    private fun msg(id: String, role: String) = MessageDto(
        id = id, sessionID = "ses", role = role, time = MessageTimeDto(0.0),
    )

    private fun part(id: String, mid: String, type: String, text: String? = null) = PartDto(
        id = id, sessionID = "ses", messageID = mid, type = type, text = text,
    )

    private fun toolPart(id: String, mid: String, tool: String, state: String) = PartDto(
        id = id, sessionID = "ses", messageID = mid, type = "tool", tool = tool, state = state,
    )
}
