package ai.kilocode.rpc

const val WORKTREE_STORAGE = ".kilo/worktrees"

fun isManagedWorktreeStorage(path: String): Boolean {
    val rel = path.replace('\\', '/').trimStart('/')
    return rel == WORKTREE_STORAGE || rel.startsWith("$WORKTREE_STORAGE/")
}
