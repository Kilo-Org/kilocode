package ai.kilocode.backend.diff

import ai.kilocode.backend.rpc.CmdOut
import ai.kilocode.backend.rpc.baseBranch
import ai.kilocode.backend.rpc.parseWorktreeList
import ai.kilocode.rpc.dto.DiffFileDto
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.CapturingProcessHandler
import com.intellij.openapi.progress.ProcessCanceledException
import kotlinx.coroutines.CancellationException
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import kotlin.io.path.fileSize
import kotlin.io.path.inputStream

internal class GitComparison private constructor(
    private val dir: Path,
    private val head: String,
    val base: String,
    private val tip: String,
    private val from: String,
    private val to: String?,
) {
    enum class Mode { Base, Local }

    companion object {
        private const val CAP = 8 * 1024 * 1024
        private const val LARGE = 2 * 1024 * 1024L
        private val CANDIDATES = listOf(
            "refs/remotes/origin/main",
            "refs/remotes/origin/master",
            "refs/heads/main",
            "refs/heads/master",
        )

        fun open(dir: Path, mode: Mode, fallback: String? = null): GitComparison? {
            if (!Files.isDirectory(dir)) return null
            val inside = runGitCommand(dir, listOf("rev-parse", "--is-inside-work-tree"))
            if (inside.exit == 128 && inside.stderr.startsWith("fatal: not a git repository")) return null
            if (inside.checked().trim() != "true") return null
            val head = revision(dir, "HEAD") ?: return null
            if (mode == Mode.Local) return GitComparison(dir, head, "", head, head, null)
            val declared = git(dir, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD", optional = true).trim()
            val selected = (listOf(declared).filter { it.isNotEmpty() } + CANDIDATES)
                .firstNotNullOfOrNull { ref -> revision(dir, ref)?.let { ref to it } }
            val ref = selected?.first ?: (fallback
                ?: baseBranch(parseWorktreeList(git(dir, "worktree", "list", "--porcelain"))))
                ?.takeIf { it != "HEAD" }?.let { "refs/heads/$it" } ?: "HEAD"
            val tip = selected?.second ?: if (ref == "HEAD") head else revision(dir, ref) ?: head
            val ancestor = git(dir, "merge-base", tip, head, optional = true).trim().ifEmpty { tip }
            val label = ref.removePrefix("refs/remotes/").removePrefix("refs/heads/")
            return GitComparison(dir, head, label, tip, ancestor, head)
        }

        private fun revision(dir: Path, ref: String): String? =
            git(dir, "rev-parse", "--verify", "--quiet", "$ref^{commit}", optional = true).trim().ifEmpty { null }

        private fun git(dir: Path, vararg args: String, optional: Boolean = false): String {
            val out = runGitCommand(dir, args.toList())
            if (optional && out.exit == 1 && out.stderr.isBlank()) return ""
            return out.checked()
        }
    }

    fun files(patches: Boolean): List<DiffFileDto> {
        val stats = parseNumstat(diff("--numstat", "-z")).associateBy { it.path }
        val status = parseNameStatus(diff("--name-status", "-z"))
        val others = if (to != null) emptyList() else {
            git(dir, "ls-files", "--others", "--exclude-standard", "-z").split('\u0000').filter { it.isNotEmpty() }
        }
        val files = stats.values.map { DiffFileDto(it.path, it.additions, it.deletions, "", status[it.path] ?: "modified") } +
            others.map { untracked(it, false) }
        if (!patches) return files
        return capDiff(files, CAP) { file, budget ->
            if (file.status == "untracked") untracked(file.file, true)
            else detail(file, stats.getValue(file.file), budget)
        }
    }

    fun counts(): Pair<Int, Int> {
        val parts = git(dir, "rev-list", "--left-right", "--count", "$tip...$head").trim().split(Regex("\\s+"))
        return parts[0].toInt() to parts[1].toInt()
    }

    fun unpushed(): Int {
        val out = runGitCommand(dir, listOf("rev-list", "--count", "@{upstream}..$head"))
        if (!out.ok) return 0
        return out.stdout.trim().toIntOrNull() ?: 0
    }

    private fun diff(vararg args: String, paths: List<String> = emptyList()): String {
        val revs = if (to == null) listOf(from) else listOf(from, to)
        val opts = listOf(
            "--literal-pathspecs", "-c", "core.quotepath=false", "diff", "--relative", "--no-color",
            "--no-ext-diff", "--no-textconv", "--find-renames", "--rename-empty",
        ) + args + revs + listOf("--") + paths
        return runGitCommand(dir, opts).checked()
    }

    private fun detail(file: DiffFileDto, stat: DiffStat, budget: Int): DiffFileDto? {
        val paths = listOfNotNull(stat.old, stat.path).distinct()
        val patch = diff("--unified=2147483647", paths = paths)
        if (patch.length > budget) return null
        if (stat.binary || patch.lineSequence().any { it.startsWith("@@ ") || it.startsWith("Binary files ") }) {
            return file.copy(patch = patch)
        }
        val old = "$from:./${stat.old ?: stat.path}"
        val next = to?.let { "$it:./${stat.path}" }
        val before = if (file.status == "added") 0L else git(dir, "cat-file", "-s", old).trim().toLong()
        val path = dir.resolve(stat.path).normalize()
        val after = when {
            file.status == "deleted" -> 0L
            next != null -> git(dir, "cat-file", "-s", next).trim().toLong()
            Files.isSymbolicLink(path) -> Files.readSymbolicLink(path).toString().length.toLong()
            else -> path.fileSize()
        }
        if (before + after + patch.length > budget) return null
        val left = if (file.status == "added") "" else git(dir, "show", old)
        val right = when {
            file.status == "deleted" -> ""
            next != null -> git(dir, "show", next)
            Files.isSymbolicLink(path) -> Files.readSymbolicLink(path).toString()
            else -> Files.readString(path)
        }
        if ('\u0000' in left || '\u0000' in right) return file.copy(patch = patch)
        return file.copy(patch = patch, before = left, after = right)
    }

    private fun untracked(rel: String, patches: Boolean): DiffFileDto {
        val file = DiffFileDto(rel, 0, 0, "", "untracked")
        val path = dir.resolve(rel).normalize()
        if (!path.startsWith(dir) || !Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) || path.fileSize() > LARGE) return file
        if (!patches) return file.copy(additions = countLines(path) ?: 0)
        val bytes = path.inputStream().use { it.readNBytes(LARGE.toInt() + 1) }
        if (bytes.size > LARGE || bytes.any { it == 0.toByte() }) return file
        val text = bytes.toString(StandardCharsets.UTF_8)
        val additions = lines(text).size
        return file.copy(additions = additions, patch = untrackedPatch(rel, text, additions))
    }
}

internal fun runGitCommand(dir: Path, args: List<String>): CmdOut {
    return try {
        val cmd = GeneralCommandLine(listOf("git") + args).withWorkDirectory(dir.toFile())
            .withCharset(StandardCharsets.UTF_8).withEnvironment("LC_ALL", "C")
        val out = CapturingProcessHandler(cmd).runProcess(30_000)
        CmdOut(if (out.isTimeout) -1 else out.exitCode, out.stdout, out.stderr)
    } catch (err: CancellationException) {
        throw err
    } catch (err: ProcessCanceledException) {
        throw err
    } catch (err: Exception) {
        CmdOut(-1, "", err.message ?: "git failed")
    }
}

private fun CmdOut.checked(): String {
    check(ok) { "Git comparison failed (exit=$exit): ${stderr.trim()}" }
    return stdout
}

internal fun capDiff(files: List<DiffFileDto>, cap: Int, fetch: (DiffFileDto, Int) -> DiffFileDto?): List<DiffFileDto> {
    var used = 0
    var misses = 0
    var full = false
    return files.map { file ->
        if (full) return@map file
        val data = fetch(file, cap - used)
        val size = data?.let { it.patch.orEmpty().length + it.before.orEmpty().length + it.after.orEmpty().length }
        if (data != null && size != null && size <= cap - used) {
            used += size
            if (used >= cap) full = true
            return@map data
        }
        misses++
        full = misses >= 3
        file
    }
}

private fun untrackedPatch(path: String, text: String, additions: Int): String = buildString {
    appendLine("diff --git a/$path b/$path")
    appendLine("new file mode 100644")
    appendLine("--- /dev/null")
    appendLine("+++ b/$path")
    appendLine("@@ -0,0 +1,$additions @@")
    lines(text).forEach { line -> appendLine("+$line") }
    if (text.isNotEmpty() && !text.endsWith("\n")) appendLine("\\ No newline at end of file")
}.removeSuffix("\n")

private fun lines(text: String): List<String> {
    if (text.isEmpty()) return emptyList()
    return text.removeSuffix("\n").split('\n')
}

private fun countLines(path: Path): Int? {
    var newlines = 0
    var last = 0
    var any = false
    path.inputStream().buffered().use { input ->
        val buf = ByteArray(8192)
        while (true) {
            val n = input.read(buf)
            if (n <= 0) break
            any = true
            for (i in 0 until n) {
                val b = buf[i].toInt()
                if (b == 0) return null
                if (b == '\n'.code) newlines++
            }
            last = buf[n - 1].toInt()
        }
    }
    if (!any) return 0
    return if (last == '\n'.code) newlines else newlines + 1
}

internal data class DiffStat(val path: String, val additions: Int, val deletions: Int, val old: String? = null, val binary: Boolean = false)

internal fun parseNameStatus(text: String): Map<String, String> = buildMap {
    val tokens = text.split('\u0000').iterator()
    while (tokens.hasNext()) {
        val code = tokens.next()
        if (code.isEmpty()) continue
        val first = tokens.next()
        val path = if (code.startsWith('R') || code.startsWith('C')) tokens.next() else first
        val status = when (code.first()) {
            'A' -> "added"
            'D' -> "deleted"
            'R' -> "renamed"
            else -> "modified"
        }
        put(path, status)
    }
}

internal fun parseNumstat(text: String): List<DiffStat> = buildList {
    val tokens = text.split('\u0000').iterator()
    while (tokens.hasNext()) {
        val token = tokens.next()
        if (token.isEmpty()) continue
        val parts = token.split('\t', limit = 3)
        val old = if (parts[2].isEmpty()) tokens.next() else null
        val path = if (old != null) tokens.next() else parts[2]
        add(DiffStat(path, parts[0].toIntOrNull() ?: 0, parts[1].toIntOrNull() ?: 0, old, parts[0] == "-"))
    }
}
