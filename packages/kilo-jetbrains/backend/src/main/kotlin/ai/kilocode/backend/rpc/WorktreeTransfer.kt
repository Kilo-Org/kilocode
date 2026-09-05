package ai.kilocode.backend.rpc

import ai.kilocode.log.KiloLog
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.CapturingProcessHandler
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption.COPY_ATTRIBUTES
import java.nio.file.StandardCopyOption.REPLACE_EXISTING
import java.nio.file.attribute.BasicFileAttributes
import java.util.concurrent.TimeUnit
import kotlin.io.path.fileSize

/**
 * Portable git-state snapshot for "Move to Worktree". Captures uncommitted changes as binary-safe
 * patch files plus untracked file copies, then applies them to a fresh worktree without ever
 * modifying the source working tree.
 *
 * Ported from `packages/kilo-vscode/src/agent-manager/git-transfer.ts`. Patches are captured to temp
 * files with a redirected stdout rather than decoded to strings: `CapturingProcessHandler` decodes
 * stdout with a charset and would corrupt `--binary` patches.
 *
 * [capture] throws when git itself fails. A failure must never look like a clean tree, or the move
 * would report success while leaving the user's tracked edits behind.
 */
internal object WorktreeTransfer {
    private val LOG = KiloLog.create(WorktreeTransfer::class.java)
    private const val MAX_FILE = 10L * 1024 * 1024 // 10 MB, same cap as VS Code
    private const val TIMEOUT = 30_000

    /** Read-only snapshot of a working tree. Patch and untracked paths point at temp files owned by the caller. */
    data class Snapshot(
        val branch: String,
        val head: String,
        val staged: Path?,
        val unstaged: Path?,
        val untracked: Map<String, Path>,
        val storage: Path,
    )

    data class ApplyResult(val ok: Boolean, val error: String? = null)

    /**
     * Captures the current git state from the worktree containing [dir] without modifying it. The returned
     * snapshot owns temp files that the caller must delete via [cleanup] in a `finally`.
     */
    fun capture(dir: Path): Snapshot {
        val resolved = git(dir, "rev-parse", "--show-toplevel")
        if (!resolved.ok) error("git rev-parse --show-toplevel failed: ${resolved.stderr.trim()}")
        val root = Path.of(resolved.stdout.trimEnd('\r', '\n').ifEmpty {
            error("git rev-parse --show-toplevel returned no directory")
        }).toAbsolutePath().normalize()
        val current = git(root, "branch", "--show-current")
        if (!current.ok) error("git branch --show-current failed: ${current.stderr.trim()}")
        val branch = current.stdout.trim()
        val rev = git(root, "rev-parse", "HEAD")
        if (!rev.ok) error("git rev-parse HEAD failed: ${rev.stderr.trim()}")
        val head = rev.stdout.trim().ifEmpty { error("git rev-parse HEAD returned no commit") }
        val conflicts = gitLines(root, "ls-files", "--unmerged", "-z")
            .mapNotNull { it.substringAfter('\t', "").takeIf(String::isNotEmpty) }
            .distinct()
        if (conflicts.isNotEmpty()) {
            error("Resolve merge conflicts before moving to a worktree: ${conflicts.joinToString(", ")}")
        }
        val storage = Files.createTempDirectory("kilo-worktree-snapshot")
        try {
            val unstaged = capturePatch(root, storage, "diff", "--binary")
            val staged = capturePatch(root, storage, "diff", "--cached", "--binary")
            val untracked = gitLines(root, "ls-files", "--others", "--exclude-standard", "-z")
                .associateWith { rel ->
                    runCatching {
                        val full = root.resolve(rel).normalize()
                        require(full.startsWith(root)) { "File is outside the source worktree" }
                        val attrs = Files.readAttributes(full, BasicFileAttributes::class.java)
                        require(attrs.isRegularFile) { "Not a regular file" }
                        require(attrs.size() <= MAX_FILE) { "File exceeds the $MAX_FILE byte transfer limit" }
                        val copy = Files.createTempFile(storage, "file", ".tmp")
                        Files.copy(full, copy, REPLACE_EXISTING)
                        require(copy.fileSize() <= MAX_FILE) { "File exceeds the $MAX_FILE byte transfer limit" }
                        copy
                    }.getOrElse { err ->
                        throw IllegalStateException("Failed to capture untracked file $rel: ${err.message}", err)
                    }
                }
            return Snapshot(branch, head, staged, unstaged, untracked, storage)
        } catch (e: Exception) {
            discard(storage)
            throw e
        }
    }

    /**
     * Applies [snapshot] into [target]: staged patch (re-staged), unstaged patch, then untracked
     * file copies. Returns the first failure encountered so the caller can roll the worktree back.
     */
    fun apply(snapshot: Snapshot, target: Path): ApplyResult {
        val root = target.toAbsolutePath().normalize()
        snapshot.staged?.let { patch ->
            val res = git(root, "apply", "--index", "--whitespace=nowarn", patch.toString())
            if (!res.ok) {
                val msg = res.stderr.trim().ifBlank { "Patch did not apply" }
                LOG.warn("worktree move: staged patch failed: $msg")
                return ApplyResult(false, "Staged patch failed: $msg")
            }
        }
        snapshot.unstaged?.let { patch ->
            val res = git(root, "apply", "--whitespace=nowarn", patch.toString())
            if (!res.ok) {
                val msg = res.stderr.trim().ifBlank { "Patch did not apply" }
                LOG.warn("worktree move: unstaged patch failed: $msg")
                return ApplyResult(false, "Unstaged patch failed: $msg")
            }
        }
        snapshot.untracked.forEach { (rel, copy) ->
            val dst = root.resolve(rel).normalize()
            if (!dst.startsWith(root)) return ApplyResult(false, "Untracked file is outside the target worktree: $rel")
            val err = runCatching {
                Files.createDirectories(dst.parent)
                Files.copy(copy, dst, COPY_ATTRIBUTES)
            }.exceptionOrNull()
            if (err != null) {
                LOG.warn("worktree move: failed to write untracked file $rel: ${err.message}", err)
                return ApplyResult(false, "Failed to write untracked file $rel: ${err.message}")
            }
        }
        return ApplyResult(true)
    }

    fun cleanup(snapshot: Snapshot?) {
        snapshot ?: return
        discard(snapshot.storage)
    }

    private fun discard(dir: Path) {
        if (!Files.exists(dir)) return
        runCatching {
            Files.walk(dir).use { files -> files.sorted(Comparator.reverseOrder()).forEach(::delete) }
        }.onFailure { err -> LOG.warn("worktree move: failed to clean up snapshot storage $dir: ${err.message}", err) }
    }

    private fun delete(file: Path) {
        if (runCatching { Files.deleteIfExists(file) }.isSuccess) return
        runCatching { file.toFile().setWritable(true) }
        runCatching { Files.deleteIfExists(file) }
            .onFailure { err -> LOG.warn("worktree move: failed to delete $file: ${err.message}", err) }
    }

    /**
     * Runs `git diff` capturing raw bytes to a temp file. Returns null only for a genuinely empty
     * diff; any failure throws so the move reports an error instead of silently transferring a
     * subset of the user's work.
     *
     * Goes through [GeneralCommandLine.toProcessBuilder] rather than a bare [ProcessBuilder] so git
     * is resolved with the same PATH as the rest of this class — a Toolbox- or Dock-launched IDE
     * inherits a minimal environment where a bare `git` can be missing. Output is still redirected
     * to a file because decoding stdout would corrupt `--binary` patches.
     */
    private fun capturePatch(root: Path, storage: Path, vararg args: String): Path? {
        val file = Files.createTempFile(storage, "patch", ".diff")
        val label = "git ${args.joinToString(" ")}"
        try {
            val cmd = GeneralCommandLine(listOf("git") + args).withWorkDirectory(root.toFile())
            val proc = cmd.toProcessBuilder()
                .redirectOutput(file.toFile())
                .redirectErrorStream(false)
                .start()
            // stdout goes to the file, so draining stderr first cannot deadlock.
            val err = proc.errorStream.use { it.readBytes().toString(StandardCharsets.UTF_8) }
            if (!proc.waitFor(TIMEOUT.toLong(), TimeUnit.MILLISECONDS)) {
                proc.destroyForcibly()
                error("$label timed out after ${TIMEOUT}ms")
            }
            val exit = proc.exitValue()
            if (exit != 0) error("$label failed (exit $exit): ${err.trim()}")
            if (file.fileSize() > 0L) return file
            Files.deleteIfExists(file)
            return null
        } catch (e: Exception) {
            Files.deleteIfExists(file)
            LOG.warn("worktree move: $label failed: ${e.message}", e)
            throw e
        }
    }

    private fun gitLines(root: Path, vararg args: String): List<String> {
        val file = Files.createTempFile("kilo-worktree-list", ".raw")
        val label = "git ${args.joinToString(" ")}"
        try {
            val cmd = GeneralCommandLine(listOf("git") + args).withWorkDirectory(root.toFile())
            val proc = cmd.toProcessBuilder()
                .redirectOutput(file.toFile())
                .redirectErrorStream(false)
                .start()
            val err = proc.errorStream.use { it.readBytes().toString(StandardCharsets.UTF_8) }
            if (!proc.waitFor(TIMEOUT.toLong(), TimeUnit.MILLISECONDS)) {
                proc.destroyForcibly()
                error("$label timed out after ${TIMEOUT}ms")
            }
            val exit = proc.exitValue()
            if (exit != 0) error("$label failed (exit $exit): ${err.trim()}")
            return String(Files.readAllBytes(file), StandardCharsets.UTF_8)
                .split('\u0000')
                .filter { it.isNotEmpty() }
        } finally {
            Files.deleteIfExists(file)
        }
    }

    private data class GitResult(val exit: Int, val stdout: String, val stderr: String) {
        val ok get() = exit == 0
    }

    private fun git(root: Path, vararg args: String): GitResult {
        return try {
            val cmd = GeneralCommandLine(listOf("git") + args)
                .withWorkDirectory(root.toFile())
                .withCharset(StandardCharsets.UTF_8)
            val out = CapturingProcessHandler(cmd).runProcess(TIMEOUT)
            GitResult(if (out.isTimeout) -1 else out.exitCode, out.stdout, out.stderr)
        } catch (e: Exception) {
            GitResult(-1, "", e.message ?: "git failed")
        }
    }
}
