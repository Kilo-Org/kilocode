package ai.kilocode.backend.rpc

import ai.kilocode.log.KiloLog
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.CapturingProcessHandler
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.fileSize

/**
 * Portable git-state snapshot for "Move to Worktree". Captures uncommitted changes as binary-safe
 * patch files plus untracked file copies, then applies them to a fresh worktree without ever
 * modifying the source working tree.
 *
 * Ported from `packages/kilo-vscode/src/agent-manager/git-transfer.ts`. Patches are captured to temp
 * files with [ProcessBuilder.redirectOutput] rather than decoded to strings: `CapturingProcessHandler`
 * decodes stdout with a charset and would corrupt `--binary` patches.
 */
internal object WorktreeTransfer {
    private val LOG = KiloLog.create(WorktreeTransfer::class.java)
    private const val MAX_FILE = 10L * 1024 * 1024 // 10 MB, same cap as VS Code
    private const val TIMEOUT = 30_000

    /** Read-only snapshot of a working tree. Patch fields point at temp files owned by the caller. */
    data class Snapshot(
        val branch: String,
        val head: String,
        val staged: Path?,
        val unstaged: Path?,
        val untracked: List<String>,
    )

    data class ApplyResult(val ok: Boolean, val error: String? = null)

    /**
     * Captures the current git state from [root]. Read-only: [root] is never modified. The returned
     * snapshot owns temp patch files that the caller must delete via [cleanup] in a `finally`.
     */
    fun capture(root: Path): Snapshot {
        val branch = git(root, "branch", "--show-current").stdout.trim()
        val head = git(root, "rev-parse", "HEAD").stdout.trim()
        val unstaged = capturePatch(root, "diff", "--binary")
        val staged = capturePatch(root, "diff", "--cached", "--binary")
        val untracked = git(root, "ls-files", "--others", "--exclude-standard").stdout
            .lineSequence()
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .filter { rel ->
                val full = root.resolve(rel).normalize()
                if (!full.startsWith(root)) {
                    LOG.warn("worktree move: skipping untracked file outside root: $rel")
                    return@filter false
                }
                val size = runCatching { full.fileSize() }.getOrDefault(0L)
                if (size > MAX_FILE) {
                    LOG.info("worktree move: skipping untracked file $rel: $size bytes exceeds ${MAX_FILE} limit")
                    false
                } else {
                    true
                }
            }
            .toList()
        return Snapshot(branch, head, staged, unstaged, untracked)
    }

    /**
     * Applies [snapshot] into [target]: staged patch (re-staged), unstaged patch, then untracked
     * file copies. Returns the first failure encountered so the caller can roll the worktree back.
     */
    fun apply(snapshot: Snapshot, source: Path, target: Path): ApplyResult {
        snapshot.staged?.let { patch ->
            val res = git(target, "apply", "--whitespace=nowarn", patch.toString())
            if (!res.ok) {
                val msg = res.stderr.trim().ifBlank { "Patch did not apply" }
                LOG.warn("worktree move: staged patch failed: $msg")
                return ApplyResult(false, "Staged patch failed: $msg")
            }
            val files = parsePatchFiles(patch)
            if (files.isNotEmpty()) git(target, "add", "--", *files.toTypedArray())
        }
        snapshot.unstaged?.let { patch ->
            val res = git(target, "apply", "--whitespace=nowarn", patch.toString())
            if (!res.ok) {
                val msg = res.stderr.trim().ifBlank { "Patch did not apply" }
                LOG.warn("worktree move: unstaged patch failed: $msg")
                return ApplyResult(false, "Unstaged patch failed: $msg")
            }
        }
        for (rel in snapshot.untracked) {
            runCatching {
                val src = source.resolve(rel).normalize()
                val dst = target.resolve(rel).normalize()
                Files.createDirectories(dst.parent)
                Files.copy(src, dst)
            }.onFailure { err -> LOG.warn("worktree move: failed to copy untracked file $rel: ${err.message}", err) }
        }
        return ApplyResult(true)
    }

    fun cleanup(snapshot: Snapshot?) {
        snapshot ?: return
        listOfNotNull(snapshot.staged, snapshot.unstaged).forEach { Files.deleteIfExists(it) }
    }

    /** Runs `git diff` capturing raw bytes to a temp file; returns null when clean or on failure. */
    private fun capturePatch(root: Path, vararg args: String): Path? {
        val file = Files.createTempFile("kilo-worktree-patch", ".diff")
        return try {
            val proc = ProcessBuilder(listOf("git") + args)
                .directory(root.toFile())
                .redirectOutput(file.toFile())
                .redirectErrorStream(false)
                .start()
            val done = proc.waitFor(TIMEOUT.toLong(), java.util.concurrent.TimeUnit.MILLISECONDS)
            if (!done) {
                proc.destroyForcibly()
                Files.deleteIfExists(file)
                return null
            }
            if (proc.exitValue() != 0 || file.fileSize() == 0L) {
                Files.deleteIfExists(file)
                null
            } else {
                file
            }
        } catch (e: Exception) {
            LOG.warn("worktree move: capture patch failed: ${e.message}", e)
            Files.deleteIfExists(file)
            null
        }
    }

    /** Extracts target paths from a unified diff's `diff --git a/... b/...` headers. */
    private fun parsePatchFiles(patch: Path): List<String> {
        // Read as Latin-1 so every byte maps to a char; header lines stay intact even in binary patches.
        val header = Regex("^diff --git a/.+ b/(.+)$")
        return runCatching {
            Files.readAllLines(patch, StandardCharsets.ISO_8859_1)
                .mapNotNull { header.find(it)?.groupValues?.get(1) }
        }.getOrDefault(emptyList())
    }

    private data class GitResult(val exit: Int, val stdout: String, val stderr: String) {
        val ok get() = exit == 0
    }

    private fun git(root: Path, vararg args: String): GitResult {
        return try {
            val cmd = GeneralCommandLine(listOf("git") + args).withWorkDirectory(root.toFile())
            val out = CapturingProcessHandler(cmd).runProcess(TIMEOUT)
            GitResult(if (out.isTimeout) -1 else out.exitCode, out.stdout, out.stderr)
        } catch (e: Exception) {
            GitResult(-1, "", e.message ?: "git failed")
        }
    }
}
