package ai.kilocode.client.session.ui.prompt

import junit.framework.TestCase
import kotlinx.coroutines.runBlocking
import java.nio.file.Path

class PromptMentionPartsTest : TestCase() {

    fun `test promptMentions parses boundary mentions`() {
        assertEquals(
            listOf(Mention("src/Main.kt", 5, 17), Mention("README.md", 22, 32)),
            promptMentions("read @src/Main.kt and @README.md"),
        )
        assertEquals(listOf(Mention("src/x.kt", 4, 13)), promptMentions("see @src/x.kt"))
    }

    fun `test promptMentions ignores embedded and bare markers`() {
        assertTrue(promptMentions("read foo@src/Main.kt and @").isEmpty())
    }

    fun `test promptMentions handles whitespace and punctuation as token text`() {
        assertEquals(
            listOf(Mention("src/a.kt", 4, 13), Mention("src/b.kt,", 14, 24)),
            promptMentions("see\t@src/a.kt\n@src/b.kt,"),
        )
    }

    fun `test fileMentions drops reserved names and deduplicates`() {
        assertEquals(
            listOf(Mention("src/a.kt", 5, 14), Mention("src/b.kt", 38, 47)),
            fileMentions("read @src/a.kt ${MentionAction.GIT_CHANGES.token} @src/a.kt @src/b.kt", setOf(MentionAction.GIT_CHANGES.name)),
        )
    }

    fun `test mentionFileParts builds file part for tracked relative path`() {
        val parts = mentionFileParts("read @src/Main.kt", setOf("src/Main.kt"), "/repo")

        assertEquals(1, parts.size)
        val part = parts.single()
        assertEquals("file", part.type)
        assertEquals("text/plain", part.mime)
        assertEquals(Path.of("/repo/src/Main.kt").toUri().toString(), part.url)
        assertEquals("Main.kt", part.filename)
        assertEquals("file", part.source?.type)
        assertEquals("src/Main.kt", part.source?.path)
        assertEquals("@src/Main.kt", part.source?.text?.value)
        assertEquals(5.0, part.source?.text?.start)
        assertEquals(17.0, part.source?.text?.end)
    }

    fun `test mentionFileParts ignores untracked path`() {
        assertTrue(mentionFileParts("read @src/Main.kt", setOf("src/Other.kt"), "/repo").isEmpty())
    }

    fun `test mentionFileParts ignores edited mention suffix`() {
        assertTrue(mentionFileParts("read @src/Main.kt-extra", setOf("src/Main.kt"), "/repo").isEmpty())
        assertTrue(mentionFileParts("read @src/Main.kt.bak", setOf("src/Main.kt"), "/repo").isEmpty())
    }

    fun `test mentionFileParts ignores embedded mention text`() {
        assertTrue(mentionFileParts("read foo@src/Main.kt", setOf("src/Main.kt"), "/repo").isEmpty())
    }

    fun `test mentionFileParts keeps absolute paths absolute`() {
        val path = "/tmp/abs.txt"
        val part = mentionFileParts("read @$path", setOf(path), "/repo").single()

        assertEquals(Path.of(path).toUri().toString(), part.url)
        assertEquals("abs.txt", part.filename)
    }

    fun `test mentionParts validates hand typed mention at send time`() = runBlocking {
        val parts = mentionParts(
            text = "read @src/Main.kt",
            directory = "/repo",
            reserved = setOf(MentionAction.GIT_CHANGES.name),
            resolve = { path -> path == "src/Main.kt" },
            gitChanges = { null },
        )

        val part = parts.single()
        assertEquals(Path.of("/repo/src/Main.kt").toUri().toString(), part.url)
        assertEquals("@src/Main.kt", part.source?.text?.value)
        assertEquals(5.0, part.source?.text?.start)
    }

    fun `test mentionParts drops unresolved file mentions`() = runBlocking {
        assertTrue(mentionParts(
            text = "read @src/Main.kt",
            directory = "/repo",
            reserved = setOf(MentionAction.GIT_CHANGES.name),
            resolve = { false },
            gitChanges = { null },
        ).isEmpty())
    }

    fun `test mentionParts handles mixed resolved reserved and git changes`() = runBlocking {
        val parts = mentionParts(
            text = "read @src/Main.kt @missing.kt ${MentionAction.GIT_CHANGES.token}",
            directory = "/repo",
            reserved = setOf(MentionAction.GIT_CHANGES.name),
            resolve = { path -> path == "src/Main.kt" },
            gitChanges = { "diff" },
        )

        assertEquals(2, parts.size)
        assertEquals("Main.kt", parts[0].filename)
        assertEquals(MentionAction.GIT_CHANGES.filename, parts[1].filename)
        assertEquals(MentionAction.GIT_CHANGES.uri, parts[1].source?.path)
    }

    fun `test mentionParts skips blank git changes`() = runBlocking {
        assertTrue(mentionParts(
            text = "review ${MentionAction.GIT_CHANGES.token}",
            directory = "/repo",
            reserved = setOf(MentionAction.GIT_CHANGES.name),
            resolve = { true },
            gitChanges = { "  " },
        ).isEmpty())
    }

    fun `test mentionParts skips git lookup without token`() = runBlocking {
        var called = false

        mentionParts(
            text = "read @src/Main.kt",
            directory = "/repo",
            reserved = setOf(MentionAction.GIT_CHANGES.name),
            resolve = { false },
            gitChanges = {
                called = true
                "diff"
            },
        )

        assertFalse(called)
    }

    fun `test gitChangesPart builds encoded data part`() {
        val part = gitChangesPart("review ${MentionAction.GIT_CHANGES.token}", "hello world+plus")!!

        assertEquals("file", part.type)
        assertEquals("text/plain", part.mime)
        assertEquals(MentionAction.GIT_CHANGES.filename, part.filename)
        assertEquals("data:text/plain;charset=utf-8,hello%20world%2Bplus", part.url)
        assertEquals("file", part.source?.type)
        assertEquals(MentionAction.GIT_CHANGES.uri, part.source?.path)
        assertNull(part.source?.clientName)
        assertNull(part.source?.uri)
        assertEquals(MentionAction.GIT_CHANGES.token, part.source?.text?.value)
        assertEquals(7.0, part.source?.text?.start)
        assertEquals(19.0, part.source?.text?.end)
    }

    fun `test gitChangesPart ignores missing blank and non boundary matches`() {
        assertNull(gitChangesPart("review ${MentionAction.GIT_CHANGES.token}", null))
        assertNull(gitChangesPart("review ${MentionAction.GIT_CHANGES.token}", "  "))
        assertNull(gitChangesPart("review ${MentionAction.GIT_CHANGES.token}-foo", "diff"))
        assertNull(gitChangesPart("review foo${MentionAction.GIT_CHANGES.token}", "diff"))
    }
}
