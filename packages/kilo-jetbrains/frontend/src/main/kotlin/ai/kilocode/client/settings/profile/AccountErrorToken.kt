package ai.kilocode.client.settings.profile

import ai.kilocode.rpc.dto.LoadErrorDto

/**
 * Telemetry token for an account step that reported a load error instead of throwing: the
 * resource it failed on, plus the HTTP status when the backend reports one.
 */
internal fun accountErrorToken(error: LoadErrorDto): String =
    error.status?.let { "${error.resource}Http$it" } ?: error.resource
