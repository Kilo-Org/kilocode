package ai.kilocode.jetbrains.i18n

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Comprehensive tests for the I18n system including named parameter substitution
 */
class I18nTest {

    @Before
    fun setUp() {
        // Ensure clean state for each test
    }

    @Test
    fun testBasicTranslationWithoutParameters() {
        val result = I18n.t("jetbrains:dialog.cancel")
        assertEquals("Cancel", result)

        val title = I18n.t("jetbrains:errors.nodejsMissing.title")
        assertEquals("Node.js environment missing", title)
    }

    @Test
    fun testNamedParameterSubstitution() {
        val result = I18n.t(
            "jetbrains:errors.nodejsMissing.message",
            mapOf("minVersion" to "18.0.0"),
        )

        // Should contain the substituted value
        assertTrue(
            "Result should contain substituted minVersion",
            result.contains("18.0.0"),
        )

        // Should not contain the placeholder anymore
        assertFalse(
            "Result should not contain placeholder",
            result.contains("{{minVersion}}"),
        )

        // Check exact expected content
        assertEquals(
            "Node.js environment not detected, please install Node.js and try again. Recommended version: 18.0.0 or higher.",
            result,
        )
    }

    @Test
    fun testMultipleNamedParameters() {
        val result = I18n.t(
            "jetbrains:errors.nodejsVersionLow.message",
            mapOf(
                "nodePath" to "/usr/bin/node",
                "nodeVersion" to "16.14.0",
                "minVersion" to "18.0.0",
            ),
        )

        // All parameters should be substituted
        assertTrue("Should contain nodePath", result.contains("/usr/bin/node"))
        assertTrue("Should contain nodeVersion", result.contains("16.14.0"))
        assertTrue("Should contain minVersion", result.contains("18.0.0"))

        // No placeholders should remain
        assertFalse("Should not contain nodePath placeholder", result.contains("{{nodePath}}"))
        assertFalse("Should not contain nodeVersion placeholder", result.contains("{{nodeVersion}}"))
        assertFalse("Should not contain minVersion placeholder", result.contains("{{minVersion}}"))

        // Check exact expected content
        assertEquals(
            "Current Node.js (/usr/bin/node) version is 16.14.0, please upgrade to 18.0.0 or higher for better compatibility.",
            result,
        )
    }

    @Test
    fun testVarargParameterOverload() {
        val result = I18n.t(
            "jetbrains:errors.nodejsVersionLow.message",
            "nodePath" to "/usr/local/bin/node",
            "nodeVersion" to "17.9.0",
            "minVersion" to "18.0.0",
        )

        assertTrue("Should contain nodePath", result.contains("/usr/local/bin/node"))
        assertTrue("Should contain nodeVersion", result.contains("17.9.0"))
        assertTrue("Should contain minVersion", result.contains("18.0.0"))
    }

    @Test
    fun testMissingParameterHandling() {
        // Test with missing required parameter
        val result = I18n.t(
            "jetbrains:errors.nodejsMissing.message",
            mapOf("wrongParam" to "value"),
        )

        // Should still contain the placeholder since parameter wasn't provided
        assertTrue(
            "Should still contain placeholder for missing param",
            result.contains("{{minVersion}}"),
        )
    }

    @Test
    fun testInvalidKeyFormat() {
        // Test key without namespace
        val result1 = I18n.t("invalidkey")
        assertEquals("invalidkey", result1) // Should fallback to key

        // Test key with multiple colons
        val result2 = I18n.t("namespace:subspace:key")
        // Should still work, taking first part as namespace
        assertEquals("namespace:subspace:key", result2) // Fallback if not found
    }

    @Test
    fun testNonExistentKey() {
        val result = I18n.t("jetbrains:nonexistent.key")
        // JetBrains ResourceBundle wraps missing keys in exclamation marks
        assertEquals("!nonexistent.key!", result)
    }

    @Test
    fun testNonExistentNamespace() {
        val result = I18n.t("nonexistent:some.key")
        assertEquals("nonexistent:some.key", result) // Should fallback to key
    }

    @Test
    fun testEmptyParameterMap() {
        val result = I18n.t("jetbrains:dialog.cancel", emptyMap())
        assertEquals("Cancel", result)

        // Test with template that has parameters but empty map provided
        val result2 = I18n.t("jetbrains:errors.nodejsMissing.message", emptyMap())
        // Should preserve placeholders
        assertTrue("Should preserve placeholder", result2.contains("{{minVersion}}"))
    }

    @Test
    fun testParameterTypesHandling() {
        // Test different parameter types (Int, String, Boolean, etc.)
        val result = I18n.t(
            "jetbrains:errors.nodejsVersionLow.message",
            mapOf(
                "nodePath" to "/usr/bin/node",
                "nodeVersion" to 16, // Int instead of String
                "minVersion" to 18.0, // Double instead of String
            ),
        )

        assertTrue("Should handle Int parameter", result.contains("16"))
        assertTrue("Should handle Double parameter", result.contains("18.0"))
    }

    @Test
    fun testSpecialCharactersInParameters() {
        val result = I18n.t(
            "jetbrains:errors.nodejsVersionLow.message",
            mapOf(
                "nodePath" to "/usr/bin/node with spaces",
                "nodeVersion" to "16.14.0-special",
                "minVersion" to ">=18.0.0",
            ),
        )

        assertTrue("Should handle spaces", result.contains("with spaces"))
        assertTrue("Should handle dashes", result.contains("16.14.0-special"))
        assertTrue("Should handle special chars", result.contains(">=18.0.0"))
    }
}
