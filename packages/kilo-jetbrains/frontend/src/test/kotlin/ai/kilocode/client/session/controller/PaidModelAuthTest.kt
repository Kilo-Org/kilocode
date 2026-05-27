package ai.kilocode.client.session.controller

import ai.kilocode.rpc.dto.MessageErrorDto
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Pure unit tests for [isPaidModelAuthRequired].
 * No IntelliJ platform setup needed — the function is entirely pure.
 */
class PaidModelAuthTest {

    private fun error(
        type: String = "APIError",
        statusCode: Int? = 401,
        responseBody: String? = """{"error":{"code":"PAID_MODEL_AUTH_REQUIRED"}}""",
    ) = MessageErrorDto(type = type, statusCode = statusCode, responseBody = responseBody)

    @Test
    fun `null error returns false`() {
        assertFalse(isPaidModelAuthRequired(null))
    }

    @Test
    fun `wrong type returns false`() {
        assertFalse(isPaidModelAuthRequired(error(type = "NetworkError")))
    }

    @Test
    fun `missing status code returns false`() {
        assertFalse(isPaidModelAuthRequired(error(statusCode = null)))
    }

    @Test
    fun `wrong status code returns false`() {
        assertFalse(isPaidModelAuthRequired(error(statusCode = 403)))
    }

    @Test
    fun `missing response body returns false`() {
        assertFalse(isPaidModelAuthRequired(error(responseBody = null)))
    }

    @Test
    fun `malformed response body returns false`() {
        assertFalse(isPaidModelAuthRequired(error(responseBody = "not json {")))
    }

    @Test
    fun `nested error code returns true`() {
        assertTrue(isPaidModelAuthRequired(error(responseBody = """{"error":{"code":"PAID_MODEL_AUTH_REQUIRED"}}""")))
    }

    @Test
    fun `top level code returns true`() {
        assertTrue(isPaidModelAuthRequired(error(responseBody = """{"code":"PAID_MODEL_AUTH_REQUIRED"}""")))
    }

    @Test
    fun `unknown code returns false`() {
        assertFalse(isPaidModelAuthRequired(error(responseBody = """{"error":{"code":"SOME_OTHER_ERROR"}}""")))
    }

    @Test
    fun `response body with extra unknown fields still returns true`() {
        assertTrue(
            isPaidModelAuthRequired(
                error(responseBody = """{"requestId":"abc","error":{"code":"PAID_MODEL_AUTH_REQUIRED","message":"Login required"}}"""),
            ),
        )
    }

    @Test
    fun `empty json object returns false`() {
        assertFalse(isPaidModelAuthRequired(error(responseBody = "{}")))
    }

    @Test
    fun `nested code does not match wrong value`() {
        assertFalse(
            isPaidModelAuthRequired(
                error(responseBody = """{"error":{"code":"UNAUTHORIZED"}}"""),
            ),
        )
    }
}
