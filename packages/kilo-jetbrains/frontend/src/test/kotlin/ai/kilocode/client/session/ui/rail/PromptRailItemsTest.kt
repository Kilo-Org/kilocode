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

    /**
     * Previews are a couple of hundred characters but an answer can be tens of kilobytes, and this runs
     * from every streamed delta. The raw text is cut before the stripping regexes see it.
     */
    /**
     * A fence-free answer must cost the budget, not its own length. The fence scan ran to the end of the
     * part looking for an opening marker, so every streamed delta re-read the whole answer and the
     * stream came out quadratic — the cost the budget exists to remove.
     */
    fun `test the fence scan is bounded by the budget`() {
        val plain = Counting("word ".repeat(40_000))

        val out = StringBuilder()
        PromptRailItems.prose(out, plain)

        assertTrue("the preview must still be filled, got ${out.length}", out.length > 1_000)
        assertTrue(
            "reads ${plain.reads} must track the budget, not the ${plain.length}-char answer",
            plain.reads < 5_000,
        )
    }

    /** A fenced block is still measured, so stepping over it reads it rather than guessing its end. */
    fun `test a fenced block is still stepped over in full`() {
        val code = "val x = 1\n".repeat(400)
        val fenced = Counting("lead\n```kotlin\n$code```\ntail")

        val out = StringBuilder()
        PromptRailItems.prose(out, fenced)

        // Whitespace is left for preview() to collapse, so assert on what was kept and dropped.
        val kept = out.toString()
        assertFalse("the fence marker must not survive: $kept", kept.contains("`"))
        assertFalse("code inside the fence must not survive: $kept", kept.contains("val x = 1"))
        assertTrue("prose on both sides must survive: $kept", kept.contains("lead") && kept.contains("tail"))
    }

    /**
     * A fenced answer must also cost a bounded amount per call. Measuring the block is unavoidable, so
     * the close search has its own cap rather than running to the end of a very large answer.
     */
    fun `test the close scan is bounded for a huge fenced answer`() {
        val code = "val x = 1\n".repeat(20_000)
        val fenced = Counting("lead\n```kotlin\n$code```\ntail")

        val out = StringBuilder()
        PromptRailItems.prose(out, fenced)

        assertTrue(
            "reads ${fenced.reads} must stay bounded for a ${fenced.length}-char answer",
            fenced.reads < 25_000,
        )
        // Crucially still no spill: hitting the cap keeps the prose in front of the fence and stops.
        val kept = out.toString()
        assertFalse("the fence marker must not survive: $kept", kept.contains("`"))
        assertFalse("code inside the fence must not survive: $kept", kept.contains("val x = 1"))
        assertTrue("prose before the fence must survive: $kept", kept.contains("lead"))
    }

    /**
     * A genuinely unclosed fence keeps its baseline behaviour: `preview()` only strips a closed pair, so
     * the text is kept rather than dropped. This is the case streaming produces mid-code-block.
     */
    fun `test a short unclosed fence is kept as text`() {
        val partial = Counting("lead\n```kotlin\nval x = 1")

        val out = StringBuilder()
        PromptRailItems.prose(out, partial)

        assertEquals("lead\n```kotlin\nval x = 1", out.toString())
    }

    private class Counting(private val src: String) : CharSequence {
        var reads = 0

        override val length get() = src.length

        override fun get(index: Int): Char {
            reads++
            return src[index]
        }

        override fun subSequence(startIndex: Int, endIndex: Int) = src.subSequence(startIndex, endIndex)
    }

    /**
     * The lead-in is inline code: it consumes budget but `preview()` discards it, so the marker after it
     * is the only thing that could reach the preview. Reading the whole text surfaces the marker, while
     * the budget stops before it. A marker placed after plain prose proves nothing, because the preview
     * is truncated to the limit long before it either way.
     */
    fun `test preview work is bounded by the text budget`() {
        val model = SessionModel()
        model.upsertMessage(message("u1", "user"))
        model.updateContent("u1", part("p1", "u1", "text", "a real prompt"))
        model.upsertMessage(message("a1", "assistant"))
        model.updateContent("a1", part("ap1", "a1", "text", "`a` ".repeat(600) + "SENTINEL_PAST_BUDGET"))

        val item = PromptRailItems.items(model).single()

        assertFalse(
            "text beyond the budget must never be read, got: ${item.answer}",
            item.answer.contains("SENTINEL"),
        )
    }

    /**
     * The budget is applied to prose, not to raw characters. Cutting raw text first could land inside a
     * fenced block, and `preview()` only strips a closed fence, so a partial code block plus a stray
     * fence marker leaked into the preview where the unbounded version dropped the block entirely.
     */
    fun `test a large fenced block is dropped rather than cut in half`() {
        val model = SessionModel()
        model.upsertMessage(message("u1", "user"))
        model.updateContent("u1", part("p1", "u1", "text", "a real prompt"))
        model.upsertMessage(message("a1", "assistant"))
        val code = "fun compute(value: Int): Int = value * 2\n".repeat(400)
        model.updateContent("a1", part("ap1", "a1", "text", "Here is the fix:\n```kotlin\n$code```\nAll done."))

        val answer = PromptRailItems.items(model).single().answer

        assertFalse("the fence marker must not leak: $answer", answer.contains("`"))
        assertFalse("code inside the fence must not leak: $answer", answer.contains("fun compute"))
        assertEquals("Here is the fix: All done.", answer)
    }

    /**
     * The prompt side has the same exposure: a prompt that is nothing but a large fenced block has to
     * still strip to empty, or it stops taking the attachment-only promotion branch.
     */
    fun `test a prompt of only fenced code still promotes the answer`() {
        val model = SessionModel()
        model.upsertMessage(message("u1", "user"))
        val code = "val x = 1\n".repeat(400)
        model.updateContent("u1", part("p1", "u1", "text", "```kotlin\n$code```"))
        model.upsertMessage(message("a1", "assistant"))
        model.updateContent("a1", part("ap1", "a1", "text", "I read the snippet"))

        val item = PromptRailItems.items(model).single()

        assertEquals("I read the snippet", item.prompt)
        assertEquals("", item.answer)
    }

    /** A streamed delta must not re-preview every turn in the transcript, only the one that changed. */
    fun `test the cache reuses turns that did not change`() {
        val model = SessionModel()
        for (i in 0 until 5) {
            model.upsertMessage(message("u$i", "user"))
            model.updateContent("u$i", part("p$i", "u$i", "text", "prompt $i"))
            model.upsertMessage(message("a$i", "assistant"))
            model.updateContent("a$i", part("ap$i", "a$i", "text", "answer $i"))
        }
        val cache = PromptRailItems.Cache()

        val first = PromptRailItems.items(model, cache)
        val again = PromptRailItems.items(model, cache)

        assertEquals(5, cache.size())
        // Unchanged turns come back as the very same instances, so no preview ran for them.
        for (i in first.indices) assertSame(first[i], again[i])

        // Streaming into one turn invalidates only that turn.
        model.updateContent("a2", part("ap2", "a2", "text", "answer 2 with more streamed in"))
        val third = PromptRailItems.items(model, cache)
        for (i in third.indices) {
            if (third[i].id == "u2") continue
            assertSame("turn ${third[i].id} must be reused", first[i], third[i])
        }

        // A cleared transcript does not leave entries behind.
        model.clear()
        PromptRailItems.items(model, cache)
        assertEquals(0, cache.size())
    }

    /**
     * An in-place edit that keeps the length must still invalidate. Folding only the length into the
     * stamp left the cache serving the old preview until something else about the turn moved.
     */
    fun `test the cache notices an equal length edit`() {
        val model = SessionModel()
        model.upsertMessage(message("u1", "user"))
        model.updateContent("u1", part("p1", "u1", "text", "first prompt"))
        model.upsertMessage(message("a1", "assistant"))
        model.updateContent("a1", part("ap1", "a1", "text", "first answer"))
        val cache = PromptRailItems.Cache()
        assertEquals("first prompt", PromptRailItems.items(model, cache).single().prompt)

        // Same length, different text.
        model.updateContent("u1", part("p1", "u1", "text", "FIRST PROMPT"))

        assertEquals("FIRST PROMPT", PromptRailItems.items(model, cache).single().prompt)
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
