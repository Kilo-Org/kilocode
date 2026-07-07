package ai.kilocode.client.ui.md

import ai.kilocode.client.ui.md.hybrid.Kind
import ai.kilocode.client.ui.md.hybrid.MdLanguage
import ai.kilocode.client.ui.md.hybrid.Mode
import ai.kilocode.client.ui.md.hybrid.Stream
import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.fileTypes.FileTypeRegistry
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.fileTypes.UnknownFileType
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class MdLanguageTest : BasePlatformTestCase() {
    fun `test terminal tags resolve streams and modes`() {
        assertKind("ansi", Stream.Stdout, Mode.Ansi)
        assertKind("ansi-stdout", Stream.Stdout, Mode.Ansi)
        assertKind("terminal", Stream.Stdout, Mode.Ansi)
        assertKind("terminal-output", Stream.Stdout, Mode.Ansi)
        assertKind("shell-command", Stream.Stdout, Mode.Command)
        assertKind("shell-output", Stream.Stdout, Mode.Shell)
        assertKind("ansi-stderr", Stream.Stderr, Mode.Ansi)
        assertKind("terminal-error", Stream.Stderr, Mode.Ansi)
        assertKind("shell-error", Stream.Stderr, Mode.Ansi)
    }

    fun `test source aliases resolve file types`() {
        mapOf(
            "rust" to "rs",
            "ruby" to "rb",
            "docker" to "dockerfile",
            "c++" to "cpp",
            "h++" to "hpp",
            "csharp" to "cs",
            "c#" to "cs",
            "fsharp" to "fs",
            "f#" to "fs",
            "batch" to "bat",
            "cmd" to "bat",
            "make" to "makefile",
            "terraform" to "tf",
            "markdown" to "md",
            "typescript" to "ts",
            "yml" to "yaml",
        ).forEach { (lang, ext) ->
            assertSame(type(ext), (MdLanguage.kind(lang) as Kind.Source).file)
        }
    }

    fun `test shell script and metadata are normalized`() {
        assertSame(type("sh"), (MdLanguage.kind("shell script") as Kind.Source).file)
        assertSame(type("json"), (MdLanguage.kind("  json title=\"sample.json\"  ") as Kind.Source).file)
        assertKind(" ansi-stdout ignored metadata ", Stream.Stdout, Mode.Ansi)
    }

    private fun assertKind(lang: String, stream: Stream, mode: Mode) {
        val kind = MdLanguage.kind(lang) as Kind.Terminal

        assertEquals(stream, kind.stream)
        assertEquals(mode, kind.mode)
    }

    private fun type(ext: String): FileType {
        val type = FileTypeRegistry.getInstance().getFileTypeByExtension(ext)
        if (type == UnknownFileType.INSTANCE) return PlainTextFileType.INSTANCE
        return type
    }
}
