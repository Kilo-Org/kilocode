package ai.kilocode.client.session.ui.rail

import ai.kilocode.client.session.model.SessionModel
import ai.kilocode.rpc.dto.MessageDto
import ai.kilocode.rpc.dto.MessageTimeDto
import ai.kilocode.rpc.dto.PartDto
import ai.kilocode.rpc.dto.SessionRevertDto
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class PromptRailItemsTest : BasePlatformTestCase() {
    fun `test preview strips markdown and collapses whitespace`() {
        val text = """
            # Heading
            - Keep [the label](https://example.com)
            > Drop `inline` and ![image](image.png)
            ```kotlin
            hidden()
            ```
        """.trimIndent()

        assertEquals("Heading Keep the label Drop and", PromptRailItems.preview(text))
    }

    fun `test items include user turns with first assistant text`() {
        val model = SessionModel()
        model.upsertMessage(message("u1", "user"))
        model.updateContent("u1", part("up1", "u1", "text", "  Build   this\nnow "))
        model.upsertMessage(message("a1", "assistant"))
        model.updateContent("a1", part("tool", "a1", "tool"))
        model.upsertMessage(message("a2", "assistant"))
        model.updateContent("a2", part("ap1", "a2", "text", "Here is **the** answer"))
        model.setQueued(setOf("u1"))

        assertEquals(
            listOf(PromptRailItem("u1", true, "Build this now", "Here is **the** answer")),
            PromptRailItems.items(model),
        )
    }

    /**
     * Inline code is a single-line construct. A class that also matched newlines let two unrelated
     * backticks on different lines swallow the text between them, which could empty a prompt and flip
     * it into the attachment-only branch.
     */
    fun `test inline code stripping does not span lines`() {
        // One stray backtick per line, so a class that also matched newlines would pair them up and
        // delete the prose in between. Balanced spans close on their own line and cannot show this.
        val text = "keep this `start\nand this end` too"

        assertEquals("keep this `start and this end` too", PromptRailItems.preview(text))
    }

    /** A promoted answer becomes the title, so it has to take the title's shorter limit. */
    fun `test promoted answer is capped at the prompt limit`() {
        val model = SessionModel()
        model.upsertMessage(message("u1", "user"))
        model.updateContent("u1", part("file", "u1", "file"))
        model.upsertMessage(message("a1", "assistant"))
        model.updateContent("a1", part("ap1", "a1", "text", "x".repeat(400)))

        val item = PromptRailItems.items(model).single()

        assertEquals(PromptRailItems.PROMPT_LIMIT, item.prompt.length)
        assertTrue(item.prompt.endsWith("…"))
        assertEquals("", item.answer)
    }

    fun `test answer becomes prompt for attachment only turn`() {
        val model = SessionModel()
        model.upsertMessage(message("u1", "user"))
        model.updateContent("u1", part("file", "u1", "file"))
        model.upsertMessage(message("a1", "assistant"))
        model.updateContent("a1", part("ap1", "a1", "text", "I can inspect that image"))

        assertEquals(
            listOf(PromptRailItem("u1", false, "I can inspect that image", "")),
            PromptRailItems.items(model),
        )
    }

    /**
     * The CLI injects user-role messages whose text is marked synthetic — compaction replays assistant
     * content that way, and so do task summaries and resumed tool results. The model strips that text,
     * which left the turn with an empty prompt and promoted the assistant's reply into the title, so a
     * response was listed as if the user had typed it.
     */
    fun `test synthetic injected turns are not listed as prompts`() {
        val model = SessionModel()
        model.upsertMessage(message("u1", "user"))
        model.updateContent("u1", part("p1", "u1", "text", "a real prompt"))
        model.upsertMessage(message("a1", "assistant"))
        model.updateContent("a1", part("ap1", "a1", "text", "the real answer"))
        // A compaction replay: user role, text flagged synthetic, followed by assistant output.
        model.upsertMessage(message("u2", "user"))
        model.updateContent("u2", part("p2", "u2", "text", "replayed assistant analysis", synthetic = true))
        model.upsertMessage(message("a2", "assistant"))
        model.updateContent("a2", part("ap2", "a2", "text", "more assistant output"))

        val items = PromptRailItems.items(model)

        assertEquals(listOf("u1"), items.map { it.id })
        assertEquals("a real prompt", items.single().prompt)
    }

    fun `test compaction and reverted turns are excluded`() {
        val model = SessionModel()
        model.upsertMessage(message("u1", "user"))
        model.updateContent("u1", part("p1", "u1", "compaction"))
        model.upsertMessage(message("u2", "user"))
        model.updateContent("u2", part("p2", "u2", "text", "visible"))
        model.upsertMessage(message("u3", "user"))
        model.updateContent("u3", part("p3", "u3", "text", "reverted"))
        model.setRevert(SessionRevertDto("u3"))

        assertEquals(listOf("u2"), PromptRailItems.items(model).map { it.id })
    }

    fun `test truncate and rail entries`() {
        assertEquals("abc…", PromptRailItems.truncate("abcdef", 4))
        val items = List(8) { PromptRailItem("u$it", false, "prompt $it", "") }

        assertEmpty(PromptRailItems.entries(items, 0))
        assertEquals(listOf(PromptRailEntry.Prompt(7)), PromptRailItems.entries(items, 1))
        assertEquals(
            listOf(PromptRailEntry.Prompt(0), PromptRailEntry.Prompt(7)),
            PromptRailItems.entries(items, 2),
        )
        assertEquals(
            listOf(
                PromptRailEntry.Prompt(0),
                PromptRailEntry.Overflow(1..5),
                PromptRailEntry.Prompt(6),
                PromptRailEntry.Prompt(7),
            ),
            PromptRailItems.entries(items, 4),
        )
    }

    fun `test capacity and active prompt`() {
        assertEquals(0, PromptRailItems.capacity(10, 7, 7))
        assertEquals(4, PromptRailItems.capacity(42, 7, 7))
        val tops = listOf(0, 100, 220)

        assertEquals(2, PromptRailItems.active(tops, 0, scrollable = false, atTop = true))
        assertEquals(0, PromptRailItems.active(tops, 0, scrollable = true, atTop = true))
        assertEquals(1, PromptRailItems.active(tops, 160, scrollable = true, atTop = false))
        assertEquals(2, PromptRailItems.active(tops, 500, scrollable = true, atTop = false))
    }

    private fun message(id: String, role: String) = MessageDto(
        id = id,
        sessionID = "ses",
        role = role,
        time = MessageTimeDto(created = 0.0),
    )

    private fun part(
        id: String,
        message: String,
        type: String,
        text: String? = null,
        synthetic: Boolean? = null,
    ) = PartDto(
        id = id,
        sessionID = "ses",
        messageID = message,
        type = type,
        text = text,
        synthetic = synthetic,
    )
}
