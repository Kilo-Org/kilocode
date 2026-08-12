package ai.kilocode.client.settings.rules

import ai.kilocode.rpc.dto.ConfigDto
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RulesSettingsStateTest {
    @Test
    fun `draft reads instructions and compat`() {
        val draft = rulesDraft(ConfigDto(instructions = listOf("./RULES.md")), true)

        assertEquals(listOf("./RULES.md"), draft.instructions)
        assertTrue(draft.compat)
    }

    @Test
    fun `unchanged instructions emit no config patch`() {
        val draft = RulesDraft(instructions = listOf("./RULES.md"), compat = true)

        assertNull(configPatch(draft, draft))
    }

    @Test
    fun `changed instructions emit full list`() {
        val from = RulesDraft(instructions = listOf("./RULES.md"))
        val to = RulesDraft(instructions = listOf("./RULES.md", "./TEAM.md"))

        assertEquals(listOf("./RULES.md", "./TEAM.md"), configPatch(from, to)?.instructions)
    }

    @Test
    fun `empty instructions list is emitted`() {
        val from = RulesDraft(instructions = listOf("./RULES.md"))
        val to = RulesDraft(instructions = emptyList())

        assertEquals(emptyList<String>(), configPatch(from, to)?.instructions)
    }

    @Test
    fun `saved match compares instructions compat and staged edits`() {
        assertTrue(savedMatches(RulesDraft(listOf("a"), true), RulesDraft(listOf("a"), true)))
        assertFalse(savedMatches(RulesDraft(listOf("a"), true), RulesDraft(listOf("b"), true)))
        assertFalse(savedMatches(RulesDraft(listOf("a"), true), RulesDraft(listOf("a"), false)))
        assertFalse(savedMatches(RulesDraft(listOf("a"), true), RulesDraft(listOf("a"), true, mapOf("a" to "x"))))
    }

    @Test
    fun `change captures config compat and edits`() {
        val from = RulesDraft(listOf("a"), false)
        assertNull(rulesChange(from, from))

        val edited = rulesChange(from, from.copy(edited = mapOf("a" to "x")))
        assertNull(edited?.config)
        assertNull(edited?.compat)
        assertEquals(mapOf("a" to "x"), edited?.edited)

        val both = rulesChange(from, RulesDraft(listOf("a", "b"), true))
        assertEquals(listOf("a", "b"), both?.config?.instructions)
        assertEquals(true, both?.compat)
    }
}
