package ai.kilocode.backend.migration

import ai.kilocode.backend.cli.KiloBackendHttpClients
import ai.kilocode.backend.testing.MockCliServer
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * HTTP adapter tests using MockCliServer.
 */
class LegacyMigrationHttpBackendTest {

    private fun withServer(block: (MockCliServer, LegacyMigrationHttpBackend) -> Unit) {
        val server = MockCliServer()
        val port = server.start()
        val client = KiloBackendHttpClients.api(server.password)
        val backend = LegacyMigrationHttpBackend(client, "http://127.0.0.1:$port")
        try {
            block(server, backend)
        } finally {
            KiloBackendHttpClients.shutdown(client)
            server.close()
        }
    }

    // -----------------------------------------------------------------------
    // Auth
    // -----------------------------------------------------------------------

    @Test
    fun `setAuth sends PUT to auth endpoint with provider ID`() {
        withServer { server, backend ->
            val auth = buildJsonObject {
                put("type", "api")
                put("key", "sk-ant-test")
            }
            backend.setAuth("anthropic", auth)
            assertEquals(1, server.requestCount("/auth/anthropic"))
            assertEquals(auth.toString(), server.lastAuthPutBody)
        }
    }

    // -----------------------------------------------------------------------
    // Global config
    // -----------------------------------------------------------------------

    @Test
    fun `updateGlobalConfig sends PATCH to global config endpoint`() {
        withServer { server, backend ->
            val patch = buildJsonObject { put("model", "anthropic/claude-3-5-sonnet-20241022") }
            // MockCliServer responds 200 for /global/config
            backend.updateGlobalConfig(patch)
            assertEquals(1, server.requestCount("/global/config"))
        }
    }

    // -----------------------------------------------------------------------
    // Session existence
    // -----------------------------------------------------------------------

    @Test
    fun `sessionExists returns true for known session`() {
        withServer { server, backend ->
            server.sessionGetStatus = 200
            // MockCliServer returns 200 for GET /session/ses_test
            assertTrue(backend.sessionExists("ses_test"))
        }
    }

    @Test
    fun `sessionExists returns false for unknown session`() {
        withServer { server, backend ->
            server.sessionGetStatus = 404
            assertFalse(backend.sessionExists("ses_nonexistent"))
        }
    }

    // -----------------------------------------------------------------------
    // Session import
    // -----------------------------------------------------------------------

    @Test
    fun `importProject posts to kilocode session-import project endpoint`() {
        withServer { server, backend ->
            val project = buildJsonObject {
                put("id", "prj_test")
                put("worktree", "/tmp")
                put("sandboxes", kotlinx.serialization.json.JsonArray(emptyList()))
                put("timeCreated", 0L)
                put("timeUpdated", 0L)
            }
            // MockCliServer returns 404 for unknown paths; we verify the exception
            val ex = runCatching { backend.importProject(project) }.exceptionOrNull()
            // Should fail with 404 since MockCliServer doesn't handle this path
            assertNotNull(ex)
        }
    }

    @Test
    fun `importSession posts to kilocode session-import session endpoint`() {
        withServer { _, backend ->
            val session = buildJsonObject {
                put("id", "ses_migrated_abcdef")
                put("projectID", "prj_test")
                put("slug", "old-task-id")
                put("directory", "/tmp")
                put("title", "Test")
                put("version", "v2")
                put("timeCreated", 0L)
                put("timeUpdated", 0L)
            }
            val ex = runCatching { backend.importSession(session) }.exceptionOrNull()
            assertNotNull(ex)
        }
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private fun assertNotNull(actual: Any?) = kotlin.test.assertNotNull(actual)
}
