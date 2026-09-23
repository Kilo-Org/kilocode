package ai.kilocode.client.settings.sandbox

import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.ConfigPatchDto
import ai.kilocode.rpc.dto.SandboxConfigPatchDto
import ai.kilocode.rpc.dto.SandboxNetworkDto
import java.net.IDN

internal data class SandboxDraft(
    val enabled: Boolean? = null,
    val network: SandboxNetworkDto? = null,
    val hosts: List<String> = emptyList(),
    val paths: List<String> = emptyList(),
)

internal fun sandboxDraft(config: ConfigDto?): SandboxDraft {
    val sandbox = config?.sandbox
    return SandboxDraft(
        enabled = sandbox?.enabled,
        network = sandbox?.network,
        hosts = sandbox?.allowedHosts.orEmpty(),
        paths = sandbox?.writablePaths.orEmpty(),
    )
}

/** Missing means exposed in JetBrains; only an explicit false hides interactive session controls. */
internal fun exposed(draft: SandboxDraft): Boolean = draft.enabled != false

internal fun effectiveNetwork(draft: SandboxDraft): SandboxNetworkDto = draft.network ?: SandboxNetworkDto.DENY

internal fun patch(from: SandboxDraft, to: SandboxDraft): ConfigPatchDto? {
    val sandbox = SandboxConfigPatchDto(
        enabled = to.enabled.takeIf { from.enabled != to.enabled },
        network = to.network.takeIf { from.network != to.network },
        allowedHosts = to.hosts.takeIf { from.hosts != to.hosts },
        writablePaths = to.paths.takeIf { from.paths != to.paths },
    )
    if (sandbox.enabled == null && sandbox.network == null && sandbox.allowedHosts == null && sandbox.writablePaths == null) return null
    return ConfigPatchDto(sandbox = sandbox)
}

/** Mirrors the CLI destination parser: exact DNS host, optional port, no IPs or widening syntax. */
internal fun normalizeDestination(input: String): String? {
    if (input.isBlank() || input != input.trim()) return null
    if (input.any { it.code <= 0x20 || it.code == 0x7f || it in "/@?#*" }) return null
    val colon = input.lastIndexOf(':')
    val port = if (colon >= 0) input.substring(colon + 1).toIntOrNull() else 443
    if (port == null || port !in 1..65535) return null
    val raw = (if (colon >= 0) input.substring(0, colon) else input).removeSuffix(".")
    if (raw.isBlank() || raw.length > 253 || raw.all { it.isDigit() || it == '.' }) return null
    val host = runCatching { IDN.toASCII(raw.lowercase(), IDN.USE_STD3_ASCII_RULES).lowercase() }.getOrNull() ?: return null
    if (host.isBlank() || host.length > 253) return null
    if (host.split('.').any { label ->
            label.isBlank() || label.length > 63 || label.startsWith('-') || label.endsWith('-') ||
                label.any { !it.isLetterOrDigit() && it != '-' }
        }) return null
    return "$host:$port"
}

internal fun normalizePath(input: String): String? = input.trim().takeIf { it.isNotEmpty() }
