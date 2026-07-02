package ai.kilocode.rpc

fun isManagedWorktreeStorage(path: String): Boolean {
    val rel = path.replace('\\', '/').trimStart('/')
    return rel == ".kilo/worktrees" || rel.startsWith(".kilo/worktrees/")
}
