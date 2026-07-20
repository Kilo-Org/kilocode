package ai.kilocode.client.settings.autoapprove

import ai.kilocode.rpc.dto.ConfigDto
import ai.kilocode.rpc.dto.PermissionRuleDto
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AutoApproveSettingsStateTest {
    @Test
    fun `draft reads permission config`() {
        val draft = permissionDraft(ConfigDto(permission = mapOf("bash" to PermissionRuleDto.Level("allow"))))

        assertEquals("allow", wildcardLevel(draft.rules["bash"]))
    }

    @Test
    fun `default level rules match CLI defaults`() {
        assertEquals("ask", defaultLevel("external_directory"))
        assertEquals("ask", defaultLevel("bash"))
        assertEquals("ask", defaultLevel("doom_loop"))
        assertEquals("allow", defaultLevel("read"))
        assertEquals("allow", defaultLevel("edit"))
    }

    @Test
    fun `effective level falls back to default when unset`() {
        val draft = PermissionDraft()

        assertEquals("ask", effectiveLevel(draft, "bash"))
        assertEquals("allow", effectiveLevel(draft, "read"))
    }

    @Test
    fun `inherited wildcard is true when tool absent or patterns wildcard missing`() {
        assertTrue(inheritedWildcard(null))
        assertFalse(inheritedWildcard(PermissionRuleDto.Level("allow")))
        assertTrue(inheritedWildcard(PermissionRuleDto.Patterns(mapOf("*.env" to "deny"))))
        assertFalse(inheritedWildcard(PermissionRuleDto.Patterns(mapOf("*" to "ask", "*.env" to "deny"))))
    }

    @Test
    fun `mostRestrictive orders allow ask deny`() {
        assertEquals("deny", mostRestrictive(listOf("allow", "deny", "ask")))
        assertEquals("ask", mostRestrictive(listOf("allow", "ask")))
        assertEquals("allow", mostRestrictive(listOf("allow", "allow")))
        assertEquals("allow", mostRestrictive(emptyList()))
    }

    @Test
    fun `setWildcard on unset tool emits scalar patch`() {
        val from = PermissionDraft()
        val to = setWildcard(from, "bash", "deny")

        assertEquals(mapOf("bash" to PermissionRuleDto.Level("deny")), permissionPatch(from, to))
    }

    @Test
    fun `setWildcard preserves existing exceptions as patterns`() {
        val from = PermissionDraft(rules = mapOf("read" to PermissionRuleDto.Patterns(mapOf("*.env" to "deny"))))
        val to = setWildcard(from, "read", "ask")

        assertEquals("ask", wildcardLevel(to.rules["read"]))
        assertEquals(listOf("*.env" to "deny"), exceptions(to.rules["read"]))
        assertEquals(
            mapOf("read" to PermissionRuleDto.Patterns(mapOf("*" to "ask", "*.env" to "deny"))),
            permissionPatch(from, to),
        )
    }

    @Test
    fun `inheritWildcard removes tool entirely when no exceptions`() {
        val from = PermissionDraft(rules = mapOf("bash" to PermissionRuleDto.Level("deny")))
        val to = inheritWildcard(from, "bash")

        assertTrue(to.rules.isEmpty())
        assertEquals(mapOf("bash" to PermissionRuleDto.Level(null)), permissionPatch(from, to))
    }

    @Test
    fun `inheritWildcard clears only wildcard when exceptions remain`() {
        val from = PermissionDraft(
            rules = mapOf("read" to PermissionRuleDto.Patterns(mapOf("*" to "ask", "*.env" to "deny"))),
        )
        val to = inheritWildcard(from, "read")

        assertTrue(inheritedWildcard(to.rules["read"]))
        assertEquals(listOf("*.env" to "deny"), exceptions(to.rules["read"]))
        assertEquals(
            mapOf("read" to PermissionRuleDto.Patterns(mapOf("*" to null, "*.env" to "deny"))),
            permissionPatch(from, to),
        )
    }

    @Test
    fun `addException on scalar wildcard preserves the wildcard as star pattern`() {
        val from = PermissionDraft(rules = mapOf("bash" to PermissionRuleDto.Level("ask")))
        val to = addException(from, "bash", "git *")

        assertEquals(listOf("git *" to "allow"), exceptions(to.rules["bash"]))
        assertEquals("ask", wildcardLevel(to.rules["bash"]))
        assertEquals(
            mapOf("bash" to PermissionRuleDto.Patterns(mapOf("*" to "ask", "git *" to "allow"))),
            permissionPatch(from, to),
        )
    }

    @Test
    fun `setException changes an existing exception level`() {
        val from = PermissionDraft(
            rules = mapOf("read" to PermissionRuleDto.Patterns(mapOf("*" to "allow", "*.env" to "deny"))),
        )
        val to = setException(from, "read", "*.env", "ask")

        assertEquals(listOf("*.env" to "ask"), exceptions(to.rules["read"]))
        assertEquals(
            mapOf("read" to PermissionRuleDto.Patterns(mapOf("*" to "allow", "*.env" to "ask"))),
            permissionPatch(from, to),
        )
    }

    @Test
    fun `removeException deletes a single pattern and keeps others`() {
        val from = PermissionDraft(
            rules = mapOf(
                "read" to PermissionRuleDto.Patterns(mapOf("*" to "allow", "*.env" to "deny", "*.key" to "deny")),
            ),
        )
        val to = removeException(from, "read", "*.env")

        assertEquals(listOf("*.key" to "deny"), exceptions(to.rules["read"]))
        assertEquals(
            mapOf("read" to PermissionRuleDto.Patterns(mapOf("*" to "allow", "*.key" to "deny", "*.env" to null))),
            permissionPatch(from, to),
        )
    }

    @Test
    fun `removeException removing the last exception removes the tool key`() {
        val from = PermissionDraft(rules = mapOf("read" to PermissionRuleDto.Patterns(mapOf("*.env" to "deny"))))
        val to = removeException(from, "read", "*.env")

        assertTrue(to.rules.isEmpty())
        assertEquals(mapOf("read" to PermissionRuleDto.Level(null)), permissionPatch(from, to))
    }

    @Test
    fun `grouped set applies scalar level to both ids`() {
        val from = PermissionDraft()
        val to = setGrouped(from, listOf("todoread", "todowrite"), "ask")

        assertEquals(
            mapOf("todoread" to PermissionRuleDto.Level("ask"), "todowrite" to PermissionRuleDto.Level("ask")),
            permissionPatch(from, to),
        )
    }

    @Test
    fun `grouped inherit deletes both ids`() {
        val from = PermissionDraft(
            rules = mapOf(
                "todoread" to PermissionRuleDto.Level("deny"),
                "todowrite" to PermissionRuleDto.Level("deny"),
            ),
        )
        val to = inheritGrouped(from, listOf("todoread", "todowrite"))

        assertEquals(
            mapOf("todoread" to PermissionRuleDto.Level(null), "todowrite" to PermissionRuleDto.Level(null)),
            permissionPatch(from, to),
        )
    }

    @Test
    fun `scalar to patterns transition emits full desired patterns`() {
        val from = PermissionDraft(rules = mapOf("edit" to PermissionRuleDto.Level("ask")))
        val to = addException(from, "edit", "*.env")

        assertEquals(
            mapOf("edit" to PermissionRuleDto.Patterns(mapOf("*" to "ask", "*.env" to "allow"))),
            permissionPatch(from, to),
        )
    }

    @Test
    fun `no-op diff returns null`() {
        val draft = PermissionDraft(
            rules = mapOf(
                "bash" to PermissionRuleDto.Patterns(mapOf("*" to "ask", "git *" to "allow")),
                "read" to PermissionRuleDto.Level("allow"),
            ),
        )

        assertNull(permissionPatch(draft, draft))
        assertNull(patch(from = draft, to = draft))
    }

    @Test
    fun `patch wraps the permission patch in a ConfigPatchDto`() {
        val from = PermissionDraft()
        val to = setWildcard(from, "bash", "deny")

        assertEquals(mapOf("bash" to PermissionRuleDto.Level("deny")), patch(from, to)?.permission)
    }

    @Test
    fun `savedMatches drops null-valued entries before comparing`() {
        val base = PermissionDraft(rules = mapOf("read" to PermissionRuleDto.Patterns(mapOf("*.env" to "deny"))))
        val draftWithNull = PermissionDraft(
            rules = mapOf("read" to PermissionRuleDto.Patterns(mapOf("*" to null, "*.env" to "deny"))),
        )

        assertTrue(savedMatches(base, draftWithNull))
        assertFalse(savedMatches(base, PermissionDraft()))
    }
}
