package ai.kilocode.backend.repo

import ai.kilocode.backend.diff.runGitCommand
import ai.kilocode.backend.rpc.CmdOut
import ai.kilocode.backend.rpc.parseWorktreeList
import ai.kilocode.backend.rpc.realPath
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/**
 * Cross-platform key for comparing two path strings without touching the filesystem.
 *
 * Inputs are already canonical ([realPath] applied), so this only has to normalize separators and a
 * trailing slash. Used for repo identity comparisons in the registry and inference.
 */
internal fun repoPathKey(path: String): String = path.replace('\\', '/').trimEnd('/')

/**
 * Resolves the **canonical main-worktree root** of the git repository containing a directory.
 *
 * Identity for the whole multi-repo feature: the registry keys on this, inference dedupes on it, and
 * session routing answers from it. A linked worktree resolves to the same root as the repository it
 * was created from, so a worktree and its parent are one repo, never two.
 *
 * Canonicalization matches [realPath] (used by the worktree service and the workspace manager) and
 * [ai.kilocode.backend.workspace.KiloBackendWorkspaceManager]'s `canonical`, so `/var` vs
 * `/private/var` and case variants compare equal.
 *
 * Results are cached briefly because routing calls this often. Negative results are cached too and
 * expire on the same short TTL, since a directory can be `git init`-ed at any time.
 */
internal object RepoRoots {
    private const val TTL_MS = 30_000L
    private const val CACHE_CAP = 512
    private const val ID_BYTES = 8

    private data class Entry(val time: Long, val root: Path?)

    private val cache = ConcurrentHashMap<String, Entry>()

    /** Drop every cached answer. Used by an explicit refresh so a just-created repo is seen. */
    fun invalidate() {
        cache.clear()
    }

    /** Canonical main-worktree root of the repo containing [dir], or null when [dir] is not in one. */
    fun resolve(dir: Path): Path? {
        val key = dir.toAbsolutePath().normalize().toString()
        val now = System.currentTimeMillis()
        cache[key]?.takeIf { now - it.time < TTL_MS }?.let { return it.root }
        val root = probe(dir)
        if (cache.size >= CACHE_CAP) cache.clear()
        cache[key] = Entry(now, root)
        return root
    }

    /** Deterministic, stable id for a canonical root. Same layout as the VS Code extension's project id. */
    fun id(root: Path): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(root.toString().toByteArray(Charsets.UTF_8))
        return digest.take(ID_BYTES).joinToString("") { "%02x".format(it) }
    }

    private fun probe(dir: Path): Path? {
        if (!Files.isDirectory(dir)) return null
        val inside = git(dir, "rev-parse", "--is-inside-work-tree")
        if (!inside.ok || inside.stdout.trim() != "true") return null

        // A linked worktree's `--git-common-dir` is the shared `<main>/.git`, so its parent is the main
        // root. Fall back to `worktree list` (main entry first) and then `--show-toplevel` when the
        // common dir is not a plain `.git` directory, which a custom gitdir layout can produce.
        val common = git(dir, "rev-parse", "--path-format=absolute", "--git-common-dir")
        if (common.ok) {
            val line = common.stdout.trim().lineSequence().firstOrNull()?.takeIf { it.isNotEmpty() }
            val commonDir = line?.let { runCatching { Path.of(it) }.getOrNull() }
            if (commonDir?.fileName?.toString() == ".git") commonDir.parent?.let { return realPath(it.toString()) }
        }

        val list = git(dir, "worktree", "list", "--porcelain")
        if (list.ok) {
            parseWorktreeList(list.stdout).firstOrNull { it.main }?.path?.let { return realPath(it) }
        }

        val top = git(dir, "rev-parse", "--show-toplevel")
        if (top.ok) top.stdout.trim().takeIf { it.isNotEmpty() }?.let { return realPath(it) }
        return null
    }

    private fun git(dir: Path, vararg args: String): CmdOut = runGitCommand(dir, args.toList())
}
