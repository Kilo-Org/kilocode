package ai.kilocode.backend.rpc

import ai.kilocode.rpc.KiloWorktreeRpcApi
import ai.kilocode.rpc.dto.CreateWorktreeRequestDto
import ai.kilocode.rpc.dto.CreateWorktreeResultDto
import ai.kilocode.rpc.dto.WorktreeBranchesDto
import ai.kilocode.rpc.dto.WorktreeDto
import ai.kilocode.rpc.dto.WorktreeListDto
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.CapturingProcessHandler
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.nio.file.Files
import java.nio.file.Path

class KiloWorktreeRpcApiImpl : KiloWorktreeRpcApi {

    override suspend fun list(directory: String): WorktreeListDto = withContext(Dispatchers.IO) {
        val base = Path.of(directory).normalize()
        val res = runGit(base, "worktree", "list", "--porcelain")
        if (!res.ok) WorktreeListDto() else WorktreeListDto(parseWorktreeList(res.stdout))
    }

    override suspend fun listBranches(directory: String): WorktreeBranchesDto = withContext(Dispatchers.IO) {
        val base = Path.of(directory).normalize()
        val refs = runGit(base, "for-each-ref", "--format=%(refname:short)", "refs/heads")
        val branches = if (!refs.ok) emptyList() else refs.stdout.lines().map { it.trim() }.filter { it.isNotEmpty() }
        val current = runGit(base, "branch", "--show-current").stdout.trim().takeIf { it.isNotEmpty() }
        WorktreeBranchesDto(branches, current)
    }

    override suspend fun create(directory: String, request: CreateWorktreeRequestDto): CreateWorktreeResultDto =
        withContext(Dispatchers.IO) {
            val base = Path.of(directory).normalize()
            val branch = request.branch.trim()
            if (branch.isEmpty()) return@withContext CreateWorktreeResultDto(error = "Branch name is required")
            val dir = base.resolve(".kilo").resolve("worktrees").resolve(branch.replace('/', '-'))
            Files.createDirectories(dir.parent)
            val args = buildList {
                addAll(listOf("worktree", "add", "-b", branch, dir.toString()))
                request.baseBranch?.trim()?.takeIf { it.isNotEmpty() }?.let { add(it) }
            }
            val res = runGit(base, *args.toTypedArray())
            if (!res.ok) CreateWorktreeResultDto(error = res.stderr.ifBlank { "git worktree add failed" })
            else CreateWorktreeResultDto(
                worktree = WorktreeDto(dir.toString(), dir.fileName.toString(), branch, dir.toString()),
            )
        }

    override suspend fun remove(directory: String, path: String, branch: String?) = withContext(Dispatchers.IO) {
        val base = Path.of(directory).normalize()
        runGit(base, "worktree", "remove", "--force", path)
        branch?.trim()?.takeIf { it.isNotEmpty() }?.let { runGit(base, "branch", "-D", it) }
        Unit
    }

    private data class GitResult(val exit: Int, val stdout: String, val stderr: String) {
        val ok get() = exit == 0
    }

    private fun runGit(base: Path, vararg args: String): GitResult {
        return try {
            val cmd = GeneralCommandLine(listOf("git") + args).withWorkDirectory(base.toFile())
            val out = CapturingProcessHandler(cmd).runProcess(30_000)
            GitResult(if (out.isTimeout) -1 else out.exitCode, out.stdout, out.stderr)
        } catch (e: Exception) {
            GitResult(-1, "", e.message ?: "git failed")
        }
    }
}

/** Parse `git worktree list --porcelain`. First entry is the main working tree. */
internal fun parseWorktreeList(raw: String): List<WorktreeDto> {
    val out = mutableListOf<WorktreeDto>()
    var path: String? = null
    var branch = "(detached)"
    var first = true
    fun flush() {
        val p = path ?: return
        val name = p.substringAfterLast('/').ifBlank { p }
        out.add(WorktreeDto(p, name, branch, p, main = first))
        first = false
        path = null
        branch = "(detached)"
    }
    for (line in raw.lines()) {
        when {
            line.startsWith("worktree ") -> { flush(); path = line.removePrefix("worktree ").trim() }
            line.startsWith("branch ") -> branch = line.removePrefix("branch ").trim().removePrefix("refs/heads/")
            line.isBlank() -> flush()
        }
    }
    flush()
    return out
}
