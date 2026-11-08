package ai.kilocode.client.session.model

import junit.framework.TestCase
import java.io.File
import kotlin.io.path.createTempDirectory

class PromptAttachmentExtractorTest : TestCase() {

    fun `test code file becomes reference attachment`() {
        val file = File.createTempFile("kilo-drop", ".php")
        file.writeText("<?php echo 'hello';")

        val item = PromptAttachmentExtractor.files(listOf(file)).single()
        val part = item.part()

        assertTrue(item.reference)
        assertEquals("text/plain", item.mime)
        assertEquals(file.toPath().toUri().toString(), item.url)
        assertEquals(file.toPath(), item.path)
        assertEquals(file.name, item.name)
        assertEquals("file", part.type)
        assertEquals("text/plain", part.mime)
        assertEquals(file.toPath().toUri().toString(), part.url)
        assertFalse(part.url.orEmpty().startsWith("data:"))
    }

    fun `test text file becomes reference attachment`() {
        val file = File.createTempFile("kilo-drop", ".txt")
        file.writeText("hello")

        val item = PromptAttachmentExtractor.files(listOf(file)).single()

        assertTrue(item.reference)
        assertEquals("text/plain", item.mime)
        assertEquals(file.toPath().toUri().toString(), item.part().url)
    }

    fun `test directory becomes reference attachment`() {
        val dir = createTempDirectory(prefix = "kilo-drop").toFile()

        val item = PromptAttachmentExtractor.files(listOf(dir)).single()
        val part = item.part()

        assertTrue(item.reference)
        assertEquals("application/x-directory", item.mime)
        assertEquals(dir.toPath().toUri().toString(), item.url)
        assertEquals(dir.toPath(), item.path)
        assertEquals(dir.name, item.name)
        assertEquals("file", part.type)
        assertEquals("application/x-directory", part.mime)
        assertEquals(dir.toPath().toUri().toString(), part.url)
    }

    fun `test image file remains embedded attachment`() {
        val file = File.createTempFile("kilo-drop", ".png")
        file.writeBytes(byteArrayOf(1, 2, 3))

        val item = PromptAttachmentExtractor.files(listOf(file)).single()

        assertFalse(item.reference)
        assertEquals("image/png", item.mime)
        assertEquals(file.toPath().toUri().toString(), item.url)
        assertTrue(item.part().url.orEmpty().startsWith("data:image/png;base64,"))
    }

    fun `test svg file becomes a text reference, not an embedded image`() {
        val file = File.createTempFile("kilo-drop", ".svg")
        file.writeText("<svg xmlns=\"http://www.w3.org/2000/svg\"><circle r=\"1\"/></svg>")

        val item = PromptAttachmentExtractor.files(listOf(file)).single()
        val part = item.part()

        assertTrue(item.reference)
        assertEquals("text/plain", item.mime)
        assertEquals("file", part.type)
        assertEquals("text/plain", part.mime)
        assertFalse(part.url.orEmpty().startsWith("data:"))
    }

    fun `test bmp file becomes a reference, not an embedded image`() {
        val file = File.createTempFile("kilo-drop", ".bmp")
        file.writeBytes(byteArrayOf(0x42, 0x4D, 1, 2, 3))

        val item = PromptAttachmentExtractor.files(listOf(file)).single()

        assertTrue(item.reference)
        assertEquals("text/plain", item.mime)
        assertFalse(PromptAttachmentExtractor.image(item.mime))
    }

    fun `test image() only accepts formats the server can decode`() {
        assertTrue(PromptAttachmentExtractor.image("image/png"))
        assertTrue(PromptAttachmentExtractor.image("image/jpeg"))
        assertTrue(PromptAttachmentExtractor.image("image/gif"))
        assertTrue(PromptAttachmentExtractor.image("image/webp"))
        assertFalse(PromptAttachmentExtractor.image("image/svg+xml"))
        assertFalse(PromptAttachmentExtractor.image("image/bmp"))
        assertFalse(PromptAttachmentExtractor.image("image/x-icon"))
    }

    fun `test oversized image is skipped but oversized code is referenced`() {
        val image = File.createTempFile("kilo-drop", ".png")
        image.writeBytes(ByteArray(10 * 1024 * 1024 + 1))
        val code = File.createTempFile("kilo-drop", ".php")
        code.writeBytes(ByteArray(10 * 1024 * 1024 + 1))

        val items = PromptAttachmentExtractor.files(listOf(image, code))

        assertEquals(listOf(code.name), items.map { it.name })
        assertTrue(items.single().reference)
    }

    fun `test nonexistent file is ignored`() {
        val file = File(File(System.getProperty("java.io.tmpdir")), "kilo-missing-${System.nanoTime()}.php")

        assertTrue(PromptAttachmentExtractor.files(listOf(file)).isEmpty())
    }
}
