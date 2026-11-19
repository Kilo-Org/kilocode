package ai.kilocode.client.ui.diagram

import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The IR must survive a process boundary so a future out-of-process engine is a drop-in. This test is
 * the mechanical guarantee: it fails the moment an AWT or otherwise unserializable type leaks in.
 */
class SerializeTest {
    private val json = Json

    @Test
    fun `every mark variant round trips`() {
        val scene = sample()

        assertEquals(scene, json.decodeFromString<Scene>(json.encodeToString(scene)))
    }

    @Test
    fun `art round trips polymorphically`() {
        val scene: Art = sample()
        val text = json.encodeToString(scene)

        assertTrue(text.contains("Scene"), "expected a discriminator in $text")
        assertEquals(scene, json.decodeFromString<Art>(text))
    }

    @Test
    fun `spec round trips`() {
        val limits = Limits(nodes = 7, span = 11, millis = 13)
        val value = Spec(FontSpec("Inter", 13, bold = true), Metrics(pad = 3.0), limits)

        assertEquals(value, json.decodeFromString<Spec>(json.encodeToString(value)))
    }

    private fun sample() = Scene(
        Type.Flowchart,
        listOf(
            Mark.Box(Rect(1.0, 2.0, 30.0, 40.0), 4.0, Role.Surface, Role.Border, dash = true),
            Mark.Box(Rect(1.0, 2.0, 3.0, 4.0), 0.0, null, null, tone = 3, soft = true),
            Mark.Oval(Rect(5.0, 6.0, 10.0, 10.0), Role.Note, null),
            Mark.Poly(listOf(Pt(0.0, 0.0), Pt(4.0, 0.0), Pt(2.0, 6.0)), Role.Surface, Role.Border),
            Mark.Sector(Pt(10.0, 10.0), 8.0, 90.0, -120.0, null, Role.Border, tone = 1),
            Mark.Edge(
                listOf(Pt(0.0, 0.0), Pt(9.0, 9.0)),
                Role.Line,
                dash = true,
                thick = true,
                head = Head.Arrow,
                tail = Head.Dot,
            ),
            Mark.Edge(listOf(Pt(0.0, 0.0), Pt(1.0, 1.0)), Role.Line, head = Head.Crow, tail = Head.Triangle, tone = 2),
            Mark.Text("hello", Pt(3.0, 4.0), Anchor.Center, Role.Text, bold = true),
            Mark.Group("cluster", listOf(Mark.Box(Rect(0.0, 0.0, 2.0, 2.0), 0.0, null, Role.Cluster))),
        ),
        Size(80.0, 90.0),
    )
}
