package ai.kilocode.client.agentManager.hosted

import ai.kilocode.rpc.dto.HostedRepositoryDto
import java.net.URI

private val scp = Regex("^([^@/\\s]+)@([^:/\\s]+):(.+)$")
private val shorthand = Regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")

/**
 * Normalizes a Git remote URL into the Cloud repository shape. GitHub remotes use a bare
 * `owner/repository` value for both HTTPS and SSH forms; every other remote keeps a clone URL.
 */
internal fun hostedRepository(url: String, branch: String?): HostedRepositoryDto {
    val value = url.trim()
    val clean = value.removeSuffix("/").removeSuffix(".git")
    if (shorthand.matches(clean)) return HostedRepositoryDto("github", repo = clean, branch = branch)
    val match = scp.matchEntire(value)
    if (match != null) {
        val host = match.groupValues[2].lowercase()
        val path = match.groupValues[3].removePrefix("/").removeSuffix("/").removeSuffix(".git")
        if (host == "github.com") return HostedRepositoryDto("github", repo = path, branch = branch)
        val ssh = "ssh://${match.groupValues[1]}@$host/$path"
        return HostedRepositoryDto(if (host == "gitlab.com") "gitlab" else "git", url = ssh, branch = branch)
    }
    val uri = runCatching { URI(value) }.getOrNull()
    val host = uri?.host?.lowercase()
    val path = uri?.path.orEmpty().removePrefix("/").removeSuffix("/").removeSuffix(".git")
    return when {
        host == "github.com" -> HostedRepositoryDto("github", repo = path, branch = branch)
        host == "gitlab.com" -> HostedRepositoryDto("gitlab", url = clean, branch = branch)
        else -> HostedRepositoryDto("git", url = clean, branch = branch)
    }
}
