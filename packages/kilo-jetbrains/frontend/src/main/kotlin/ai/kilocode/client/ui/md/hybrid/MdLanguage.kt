package ai.kilocode.client.ui.md.hybrid

import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.fileTypes.FileTypeRegistry
import com.intellij.openapi.fileTypes.PlainTextFileType
import com.intellij.openapi.fileTypes.UnknownFileType

internal sealed class Kind {
    data class Source(val file: FileType) : Kind()
    data class Terminal(val stream: Stream, val mode: Mode) : Kind()
}

internal enum class Stream { Stdout, Stderr }

internal enum class Mode { Ansi, Shell, Command }

internal object MdLanguage {
    /** Internal terminal fence tags produced by ShellToolView shell transcript markdown. */
    private val terms = mapOf(
        "ansi" to Kind.Terminal(Stream.Stdout, Mode.Ansi),
        "ansi-stdout" to Kind.Terminal(Stream.Stdout, Mode.Ansi),
        "terminal" to Kind.Terminal(Stream.Stdout, Mode.Ansi),
        "terminal-output" to Kind.Terminal(Stream.Stdout, Mode.Ansi),
        "shell-command" to Kind.Terminal(Stream.Stdout, Mode.Command),
        "shell-output" to Kind.Terminal(Stream.Stdout, Mode.Shell),
        "ansi-stderr" to Kind.Terminal(Stream.Stderr, Mode.Ansi),
        "terminal-error" to Kind.Terminal(Stream.Stderr, Mode.Ansi),
        "shell-error" to Kind.Terminal(Stream.Stderr, Mode.Ansi),
    )

    // Alias layer only; canonical extensions fall through to FileTypeRegistry below.
    private val files = mapOf(
        "kotlin" to "kt",
        "javascript" to "js",
        "typescript" to "ts",
        "python" to "py",
        "bash" to "sh",
        "shell" to "sh",
        "zsh" to "sh",
        "shellscript" to "sh",
        "markdown" to "md",
        "yml" to "yaml",
        "golang" to "go",
        "rust" to "rs",
        "ruby" to "rb",
        "docker" to "dockerfile",
        "c++" to "cpp",
        "h++" to "hpp",
        "csharp" to "cs",
        "c#" to "cs",
        "fsharp" to "fs",
        "f#" to "fs",
        "powershell" to "ps1",
        "pwsh" to "ps1",
        "batch" to "bat",
        "cmd" to "bat",
        "make" to "makefile",
        "terraform" to "tf",
    )

    fun kind(lang: String?): Kind {
        val key = lang?.trim()?.split(Regex("\\s+"))?.take(2)?.joinToString(" ")?.lowercase().orEmpty()
        terms[key]?.let { return it }
        if (key == "shell script") return Kind.Source(type("sh"))
        val single = key.substringBefore(' ')
        terms[single]?.let { return it }
        files[key]?.let { return Kind.Source(type(it)) }
        files[single]?.let { return Kind.Source(type(it)) }
        type(key).takeIf { it != PlainTextFileType.INSTANCE }?.let { return Kind.Source(it) }
        return Kind.Source(type(single))
    }

    private fun type(ext: String): FileType {
        val type = FileTypeRegistry.getInstance().getFileTypeByExtension(ext)
        if (type == UnknownFileType.INSTANCE) return PlainTextFileType.INSTANCE
        return type
    }
}
