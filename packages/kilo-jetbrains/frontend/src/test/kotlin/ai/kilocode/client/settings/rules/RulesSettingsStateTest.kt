package ai.kilocode.client.settings.rules

import ai.kilocode.rpc.dto.ConfigDto
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RulesSettingsStateTest {
    @Test
    fun `draft reads instructions`() {
        val draft = rulesDraft(ConfigDto(instructions = listOf("./RULES.md")))

        assertEquals(listOf("./RULES.md"), draft.instructions)
    }

    @Test
    fun `unchanged instructions emit no config patch`() {
        val draft = RulesDraft(instructions = listOf("./RULES.md"))

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
    fun `saved match compares instructions and staged edits`() {
        assertTrue(savedMatches(RulesDraft(listOf("a")), RulesDraft(listOf("a"))))
        assertEquals(false, savedMatches(RulesDraft(listOf("a")), RulesDraft(listOf("b"))))
        assertEquals(false, savedMatches(RulesDraft(listOf("a")), RulesDraft(listOf("a"), mapOf("a" to "x"))))
    }

    @Test
    fun `change captures config and edits`() {
        val from = RulesDraft(listOf("a"))
        assertNull(rulesChange(from, from))

        val edited = rulesChange(from, from.copy(edited = mapOf("a" to "x")))
        assertNull(edited?.config)
        assertEquals(mapOf("a" to "x"), edited?.edited)

        val both = rulesChange(from, RulesDraft(listOf("a", "b")))
        assertEquals(listOf("a", "b"), both?.config?.instructions)
    }
}
