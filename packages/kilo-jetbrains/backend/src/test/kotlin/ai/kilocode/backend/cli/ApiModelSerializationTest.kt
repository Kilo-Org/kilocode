package ai.kilocode.backend.cli

import ai.kilocode.jetbrains.api.infrastructure.Serializer
import ai.kilocode.jetbrains.api.model.Config
import ai.kilocode.jetbrains.api.model.GlobalHealth200Response
import ai.kilocode.jetbrains.api.model.KiloNotifications200ResponseInner
import ai.kilocode.jetbrains.api.model.KiloNotifications200ResponseInnerAction
import ai.kilocode.jetbrains.api.model.KiloProfile200Response
import ai.kilocode.jetbrains.api.model.KiloProfile200ResponseBalance
import ai.kilocode.jetbrains.api.model.KiloProfile200ResponseProfile
import ai.kilocode.jetbrains.api.model.KiloProfile200ResponseProfileOrganizationsInner
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Verifies that the generated API model classes serialize/deserialize
 * correctly using the same [Serializer.kotlinxSerializationJson] instance
 * that the production [DefaultApi] client uses.
 */
class ApiModelSerializationTest {

    private val json = Serializer.kotlinxSerializationJson

    @Test
    fun `GlobalHealth200Response roundtrip`() {
        val src = """{"healthy":true,"version":"2.1.0"}"""
        val obj = json.decodeFromString<GlobalHealth200Response>(src)
        assertTrue(obj.healthy)
        assertEquals("2.1.0", obj.version)

        val back = json.encodeToString(GlobalHealth200Response.serializer(), obj)
        assertTrue(back.contains(""""healthy":true"""))
        assertTrue(back.contains(""""version":"2.1.0""""))
    }

    @Test
    fun `Config deserializes minimal JSON`() {
        val obj = json.decodeFromString<Config>("""{}""")
        assertNull(obj.model)
        assertNull(obj.provider)
        assertNull(obj.mcp)
    }

    @Test
    fun `Config deserializes with known fields`() {
        val src = """{"model":"claude-4","username":"alice"}"""
        val obj = json.decodeFromString<Config>(src)
        assertEquals("claude-4", obj.model)
        assertEquals("alice", obj.username)
    }

    @Test
    fun `Config ignores unknown fields`() {
        val src = """{"model":"test","totally_new_field":"value","nested":{"a":1}}"""
        val obj = json.decodeFromString<Config>(src)
        assertEquals("test", obj.model)
    }

    @Test
    fun `KiloNotifications200ResponseInner with action`() {
        val src = """{
            "id": "notif-1",
            "title": "Update available",
            "message": "Version 3.0 is out",
            "action": {"actionText": "Update now", "actionURL": "https://example.com/update"}
        }"""
        val obj = json.decodeFromString<KiloNotifications200ResponseInner>(src)
        assertEquals("notif-1", obj.id)
        assertEquals("Update available", obj.title)
        assertEquals("Version 3.0 is out", obj.message)
        assertNotNull(obj.action)
        assertEquals("Update now", obj.action!!.actionText)
        assertEquals("https://example.com/update", obj.action!!.actionURL)
    }

    @Test
    fun `KiloNotifications200ResponseInner without action`() {
        val src = """{"id":"n2","title":"Info","message":"Hello"}"""
        val obj = json.decodeFromString<KiloNotifications200ResponseInner>(src)
        assertEquals("n2", obj.id)
        assertNull(obj.action)
        assertNull(obj.showIn)
    }

    @Test
    fun `KiloNotifications200ResponseInner with showIn and suggestModelId`() {
        val src = """{
            "id": "n3",
            "title": "Try new model",
            "message": "Check it out",
            "showIn": ["cli", "vscode"],
            "suggestModelId": "claude-4"
        }"""
        val obj = json.decodeFromString<KiloNotifications200ResponseInner>(src)
        assertEquals(listOf("cli", "vscode"), obj.showIn)
        assertEquals("claude-4", obj.suggestModelId)
    }

    @Test
    fun `empty notifications array`() {
        val list = json.decodeFromString<List<KiloNotifications200ResponseInner>>("[]")
        assertTrue(list.isEmpty())
    }

    @Test
    fun `KiloProfile200Response with balance`() {
        val src = """{
            "profile": {"email": "user@test.com", "name": "User"},
            "balance": {"balance": 42.5},
            "currentOrgId": "org-1"
        }"""
        val obj = json.decodeFromString<KiloProfile200Response>(src)
        assertEquals("user@test.com", obj.profile.email)
        assertEquals("User", obj.profile.name)
        assertNotNull(obj.balance)
        assertEquals(42.5, obj.balance!!.balance)
        assertEquals("org-1", obj.currentOrgId)
    }

    @Test
    fun `KiloProfile200Response with null balance`() {
        val src = """{
            "profile": {"email": "user@test.com"},
            "balance": null,
            "currentOrgId": null
        }"""
        val obj = json.decodeFromString<KiloProfile200Response>(src)
        assertEquals("user@test.com", obj.profile.email)
        assertNull(obj.balance)
        assertNull(obj.currentOrgId)
    }

    @Test
    fun `KiloProfile200Response with organizations`() {
        val src = """{
            "profile": {
                "email": "user@test.com",
                "organizations": [
                    {"id": "org-1", "name": "Acme", "role": "admin"},
                    {"id": "org-2", "name": "Beta", "role": "member"}
                ]
            },
            "balance": null,
            "currentOrgId": "org-1"
        }"""
        val obj = json.decodeFromString<KiloProfile200Response>(src)
        assertNotNull(obj.profile.organizations)
        assertEquals(2, obj.profile.organizations!!.size)
        assertEquals("Acme", obj.profile.organizations!![0].name)
        assertEquals("admin", obj.profile.organizations!![0].role)
    }

    @Test
    fun `Config roundtrip preserves model field`() {
        val original = Config(model = "gpt-4o", username = "test")
        val encoded = json.encodeToString(Config.serializer(), original)
        val decoded = json.decodeFromString<Config>(encoded)
        assertEquals("gpt-4o", decoded.model)
        assertEquals("test", decoded.username)
    }
}
