package ai.kilocode.backend.worktree.orphans

import ai.kilocode.log.KiloLog
import java.io.IOException
import java.nio.file.FileVisitResult
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.SimpleFileVisitor
import java.nio.file.attribute.BasicFileAttributes
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext

private val LOG = KiloLog.create(OrphanTree::class.java)

/** Marker class for [KiloLog.create] — this file has no class of its own. */
private class OrphanTree

/**
 * Apparent on-disk size of each leftover worktree directory under `.kilo/worktrees/`.
 *
 * No dependency on [ai.kilocode.backend.rpc.KiloWorktreeRpcApiImpl] or any other worktree machinery —
 * this is a pure filesystem walk, callable from the RPC layer or a test. Mirrors VS Code's
 * `orphans/size.ts`.
 *
 * Cancellation here has to be cooperative. The caller cancels this pass whenever the orphan set
 * changes or a delete starts, but [Files.walkFileTree] is blocking and cannot be interrupted, so a
 * cancelled coroutine on [Dispatchers.IO] would otherwise keep walking every remaining path. The loop
 * re-checks between paths and the walk itself is handed an `isActive` probe.
 *
 * A path that fails to walk — permission error, disappeared mid-walk — is omitted from the result
 * rather than failing the whole batch, so one bad orphan can never block the size of the rest.
 */
suspend fun orphanSizes(paths: List<String>): Map<String, Long> =
    withContext(Dispatchers.IO) {
        val result = mutableMapOf<String, Long>()
        for (raw in paths) {
            ensureActive()
            val path = Path.of(raw).normalize()
            // A directory that is gone (already removed, mid-delete elsewhere) is a failure to
            // measure, not a size of zero — omitted the same as a walk that throws below.
            if (!Files.isDirectory(path)) {
                LOG.info("worktree orphan size skipped: path=$raw reason=missing")
                continue
            }
            val size = runCatching { walkSize(path) { isActive } }.getOrElse { err ->
                LOG.info("worktree orphan size skipped: path=$raw message=${err.message}")
                null
            } ?: continue
            result[raw] = size
        }
        result
    }

/**
 * Apparent size of [root]: sum of regular-file sizes, never following symlinks.
 *
 * Answers null once [active] goes false, so a walk that stopped early contributes nothing rather
 * than a partial sum that would be indistinguishable from a real measurement.
 */
private fun walkSize(root: Path, active: () -> Boolean): Long? {
    if (!Files.isDirectory(root)) return 0
    var total = 0L
    var stopped = false
    Files.walkFileTree(
        root,
        object : SimpleFileVisitor<Path>() {
            override fun preVisitDirectory(dir: Path, attrs: BasicFileAttributes): FileVisitResult = step()

            override fun visitFile(file: Path, attrs: BasicFileAttributes): FileVisitResult {
                val next = step()
                if (next == FileVisitResult.TERMINATE) return next
                if (!attrs.isSymbolicLink) total += attrs.size()
                return next
            }

            override fun visitFileFailed(file: Path, exc: IOException): FileVisitResult = FileVisitResult.CONTINUE

            private fun step(): FileVisitResult {
                if (active()) return FileVisitResult.CONTINUE
                stopped = true
                return FileVisitResult.TERMINATE
            }
        },
    )
    return if (stopped) null else total
}
