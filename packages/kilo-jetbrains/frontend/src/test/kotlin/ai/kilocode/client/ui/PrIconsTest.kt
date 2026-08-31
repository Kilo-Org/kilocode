package ai.kilocode.client.ui

import ai.kilocode.rpc.dto.GhChecks
import ai.kilocode.rpc.dto.GhChecksDto
import ai.kilocode.rpc.dto.GhReview
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Conformance checks for the pull-request status icons. The IntelliJ loader recolors by matching literal
 * hex strings, so an off-palette color themes incorrectly and a missing `_dark` sibling renders invisible
 * in Dark — both of which look fine in a code review and only show up when someone switches theme.
 */
class PrIconsTest {
    private val names = listOf(
        "pr-review-approved",
        "pr-review-changes",
        "pr-checks-passed",
        "pr-checks-failed",
        "pr-checks-running",
    )

    @Test
    fun `every icon ships a light and dark variant`() {
        for (name in names) {
            assertNotNull(read("$name.svg"), "missing light variant for $name")
            assertNotNull(read("${name}_dark.svg"), "missing dark variant for $name")
        }
    }

    @Test
    fun `every icon uses the action canvas`() {
        for (name in names) {
            for (file in listOf("$name.svg", "${name}_dark.svg")) {
                val svg = assertNotNull(read(file))
                assertTrue(svg.contains("""width="16""""), "$file is not 16 wide")
                assertTrue(svg.contains("""height="16""""), "$file is not 16 high")
                assertTrue(svg.contains("""viewBox="0 0 16 16""""), "$file does not use the 16 grid")
                assertTrue(svg.contains("""fill="none""""), "$file must not rely on an inherited root fill")
            }
        }
    }

    @Test
    fun `every color comes from the canonical palette`() {
        for (name in names) {
            for (file in listOf("$name.svg", "${name}_dark.svg")) {
                val svg = assertNotNull(read(file))
                val used = HEX.findAll(svg).map { it.value.uppercase() }.toSet()
                assertTrue(used.isNotEmpty(), "$file paints nothing")
                for (color in used) {
                    assertTrue(PALETTE.contains(color), "$file uses off-palette $color")
                }
            }
        }
    }

    @Test
    fun `light and dark variants keep identical geometry`() {
        for (name in names) {
            val light = assertNotNull(read("$name.svg"))
            val dark = assertNotNull(read("${name}_dark.svg"))

            // Only the palette may differ; diverging paths glitch HiDPI overlays and selection painting.
            assertEquals(strip(light), strip(dark), "$name changes geometry between themes")
        }
    }

    @Test
    fun `no icon paints a plain white glyph in the dark theme`() {
        for (name in names) {
            val dark = assertNotNull(read("${name}_dark.svg"))

            // White on a dark-theme accent fill is the specific combination the palette forbids.
            assertTrue(!dark.contains("\"white\""), "$name uses plain white in Dark")
        }
    }

    @Test
    fun `the failed and running badges carry the muted fills in both themes`() {
        // These two land on rows the user has not acted on yet, several at a time. The saturated fills
        // turned the list into a traffic light, so both themes use the muted tone of the same hue.
        for (name in listOf("pr-checks-failed", "pr-checks-running")) {
            val light = assertNotNull(read("$name.svg"))
            val dark = assertNotNull(read("${name}_dark.svg"))
            val fill = FILL.find(light)?.groupValues?.get(1)

            assertEquals(fill, FILL.find(dark)?.groupValues?.get(1), "$name does not share its dark fill")
            assertTrue(MUTED.contains(fill?.uppercase()), "$name fills with $fill instead of a muted tone")
        }
    }

    @Test
    fun `review glyphs are shown only for a verdict the user can act on`() {
        assertEquals(PrIcons.reviewApproved, PrIcons.review(GhReview.APPROVED))
        assertEquals(PrIcons.reviewChanges, PrIcons.review(GhReview.CHANGES_REQUESTED))
        assertNull(PrIcons.review(GhReview.PENDING))
        assertNull(PrIcons.review(GhReview.NONE))
    }

    @Test
    fun `check glyphs follow the rolled up verdict`() {
        assertEquals(PrIcons.checksPassed, PrIcons.checks(GhChecksDto(GhChecks.PASSED, total = 2, passed = 2)))
        assertEquals(PrIcons.checksFailed, PrIcons.checks(GhChecksDto(GhChecks.FAILED, total = 2, failed = 1)))
        assertEquals(PrIcons.checksRunning, PrIcons.checks(GhChecksDto(GhChecks.PENDING, total = 2, pending = 2)))
        assertNull(PrIcons.checks(GhChecksDto()))
    }

    private fun read(file: String): String? =
        PrIconsTest::class.java.getResourceAsStream("/icons/$file")?.bufferedReader()?.use { it.readText() }

    /**
     * The file with every color literal reduced to the same placeholder, leaving only geometry and
     * stroke metrics. Named colors collapse to the quoted form hex values leave behind, so a light glyph
     * painted `white` still compares equal to its dark partner's muted fill.
     */
    private fun strip(svg: String): String = HEX.replace(svg, "#").replace("\"white\"", "\"#\"")

    private companion object {
        val HEX = Regex("#[0-9A-Fa-f]{6}")
        val FILL = Regex("""fill="(#[0-9A-Fa-f]{6})"""")

        /** The palette's muted red and orange, which the loud CI verdicts are painted with. */
        val MUTED = setOf("#DB5C5C", "#C77D55")

        /** Light and dark entries from the icon skill's palette that these icons are allowed to use. */
        val PALETTE = setOf(
            "#6C707E", "#CED0D6",
            "#818594", "#6F737A",
            "#208A3C", "#57965C",
            "#55A76A",
            "#253627",
            "#DB3B4B", "#DB5C5C",
            "#E55765",
            "#402929",
            "#E66D17", "#C77D55",
            "#FFAF0F", "#F2C55C",
            "#5E4D33",
        )
    }
}
