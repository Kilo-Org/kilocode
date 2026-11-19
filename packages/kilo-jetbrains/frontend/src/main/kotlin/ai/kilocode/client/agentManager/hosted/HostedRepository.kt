package ai.kilocode.client.agentManager.hosted

import ai.kilocode.rpc.dto.HostedRepositoryDto
import java.net.URI
import java.security.MessageDigest
import java.util.HexFormat

private val scp = Regex("^([^@/\\s]+)@([^:/\\s]+):(.+)$")
private val shorthand = Regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
private const val SCP_USER = 1
private const val SCP_HOST = 2
private const val SCP_PATH = 3
private const val NO_PORT = -1
private const val HTTP_PORT = 80
private const val HTTPS_PORT = 443
private const val SSH_PORT = 22

/** The repository name shown in creation dialogs, without credentials or a `.git` suffix. */
internal fun hostedRepositoryName(url: String): String {
    val clean = url.trim().removeSuffix("/").removeSuffix(".git")
    return clean.substringAfterLast('/').substringAfterLast(':')
}

/**
 * Stable repository identity for IDE settings. Transport and credentials are intentionally omitted
 * so HTTPS and SSH clones share a preference and secrets never enter the settings file.
 */
internal fun hostedRepositoryKey(url: String): String {
    val value = url.trim()
    val clean = value.removeSuffix("/").removeSuffix(".git")
    val match = scp.matchEntire(value)
    val uri = runCatching { URI(value) }.getOrNull()
    return when {
        shorthand.matches(clean) -> "github:${clean.lowercase()}"
        match != null -> hostedRepositoryKey(match.groupValues[SCP_HOST], match.groupValues[SCP_PATH], NO_PORT, "ssh")
        uri?.host != null -> hostedRepositoryKey(uri.host, uri.path.orEmpty(), uri.port, uri.scheme)
        else -> {
            val hash = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
            "unknown:${HexFormat.of().formatHex(hash)}"
        }
    }
}

private fun hostedRepositoryKey(host: String, value: String, port: Int, scheme: String?): String {
    val domain = host.lowercase()
    val path = value.substringBefore('?').substringBefore('#')
        .removePrefix("/").removeSuffix("/").removeSuffix(".git")
    val normalized = when {
        scheme.equals("http", true) && port == HTTP_PORT -> NO_PORT
        scheme.equals("https", true) && port == HTTPS_PORT -> NO_PORT
        scheme.equals("ssh", true) && port == SSH_PORT -> NO_PORT
        else -> port
    }
    val address = if (normalized < 0) domain else "$domain:$normalized"
    return when {
        domain == "github.com" && normalized < 0 -> "github:${path.lowercase()}"
        domain == "github.com" -> "$address/${path.lowercase()}"
        else -> "$address/$path"
    }
}

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
        val host = match.groupValues[SCP_HOST].lowercase()
        val path = match.groupValues[SCP_PATH].removePrefix("/").removeSuffix("/").removeSuffix(".git")
        if (host == "github.com") return HostedRepositoryDto("github", repo = path, branch = branch)
        val ssh = "ssh://${match.groupValues[SCP_USER]}@$host/$path"
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
