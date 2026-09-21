package ai.kilocode.client.ui.diagram

import ai.kilocode.client.ui.diagram.mermaid.Mermaid
import kotlinx.coroutines.runBlocking
import kotlin.test.Test

class SeqLayoutTest {
    private val engine = Mermaid(FakeMeasure())

    /** The reported width must cover the left-anchored loop label, not just its anchor. */
    @Test
    fun `self messages render loops`() = assertScene(
        """
        scene Sequence 127x230
        edge 28,38 28,222 role=Muted dash=true thick=false head=None tail=None
        box 8,8 39x30 arc=4 fill=Surface line=Border dash=false
        text "A" at=28,23 anchor=Center role=Text bold=true
        edge 28,102 76,102 76,150 28,150 role=Line dash=false thick=false head=Arrow tail=None
        text "retry" at=84,109 anchor=Left role=Muted bold=false
        """,
        draw("sequenceDiagram\n A->>A: retry"),
    )

    @Test
    fun `notes can span participants`() = assertScene(
        """
        scene Sequence 142x274
        edge 28,38 28,266 role=Muted dash=true thick=false head=None tail=None
        edge 115,38 115,266 role=Muted dash=true thick=false head=None tail=None
        box 8,8 39x30 arc=4 fill=Surface line=Border dash=false
        text "A" at=28,23 anchor=Center role=Text bold=true
        box 95,8 39x30 arc=4 fill=Surface line=Border dash=false
        text "B" at=115,23 anchor=Center role=Text bold=true
        box 9,94 124x30 arc=4 fill=Note line=Border dash=false
        text "shared" at=71,109 anchor=Center role=Text bold=false
        edge 28,194 115,194 role=Line dash=false thick=false head=Arrow tail=None
        text "go" at=71,183 anchor=Center role=Muted bold=false
        """,
        draw("sequenceDiagram\n participant A\n participant B\n Note over A,B: shared\n A->>B: go"),
    )

    @Test
    fun `blocks render dashed frames with split labels`() = assertScene(
        """
        scene Sequence 142x396
        edge 28,38 28,388 role=Muted dash=true thick=false head=None tail=None
        edge 115,38 115,388 role=Muted dash=true thick=false head=None tail=None
        box 8,8 39x30 arc=4 fill=Surface line=Border dash=false
        text "A" at=28,23 anchor=Center role=Text bold=true
        box 95,8 39x30 arc=4 fill=Surface line=Border dash=false
        text "B" at=115,23 anchor=Center role=Text bold=true
        edge 28,116 115,116 role=Line dash=false thick=false head=Arrow tail=None
        text "go" at=71,105 anchor=Center role=Muted bold=false
        edge 28,216 115,216 role=Line dash=false thick=false head=Arrow tail=None
        text "one" at=71,205 anchor=Center role=Muted bold=false
        edge 8,264 126,264 role=Cluster dash=true thick=false head=None tail=None
        text "no" at=16,271 anchor=Left role=Muted bold=false
        edge 28,308 115,308 role=Line dash=false thick=false head=Arrow tail=None
        text "two" at=71,297 anchor=Center role=Muted bold=false
        box 8,164 118x192 arc=4 fill=- line=Cluster dash=true
        box 8,164 65x22 arc=4 fill=Note line=Cluster dash=false
        text "alt yes" at=16,175 anchor=Left role=Muted bold=true
        """,
        draw("sequenceDiagram\n A->>B: go\n alt yes\n A->>B: one\n else no\n A->>B: two\n end"),
    )

    @Test
    fun `autonumber prefixes message labels`() = assertScene(
        """
        scene Sequence 142x266
        edge 28,38 28,258 role=Muted dash=true thick=false head=None tail=None
        edge 115,38 115,258 role=Muted dash=true thick=false head=None tail=None
        box 8,8 39x30 arc=4 fill=Surface line=Border dash=false
        text "A" at=28,23 anchor=Center role=Text bold=true
        box 95,8 39x30 arc=4 fill=Surface line=Border dash=false
        text "B" at=115,23 anchor=Center role=Text bold=true
        edge 28,116 115,116 role=Line dash=false thick=false head=Arrow tail=None
        text "1. one" at=71,105 anchor=Center role=Muted bold=false
        edge 115,186 28,186 role=Line dash=false thick=false head=Arrow tail=None
        text "2. two" at=71,175 anchor=Center role=Muted bold=false
        """,
        draw("sequenceDiagram\n autonumber\n A->>B: one\n B->>A: two"),
    )

    /** `A->>+B` with no matching deactivate is normal mermaid and must still draw the bar. */
    @Test
    fun `unmatched activations still draw a bar`() = assertScene(
        """
        scene Sequence 142x196
        edge 28,38 28,188 role=Muted dash=true thick=false head=None tail=None
        edge 115,38 115,188 role=Muted dash=true thick=false head=None tail=None
        box 8,8 39x30 arc=4 fill=Surface line=Border dash=false
        text "A" at=28,23 anchor=Center role=Text bold=true
        box 95,8 39x30 arc=4 fill=Surface line=Border dash=false
        text "B" at=115,23 anchor=Center role=Text bold=true
        edge 28,116 111,116 role=Line dash=false thick=false head=Arrow tail=None
        text "open" at=69,105 anchor=Center role=Muted bold=false
        box 111,94 8x70 arc=0 fill=Accent line=Border dash=false
        """,
        draw("sequenceDiagram\n A->>+B: open"),
    )

    @Test
    fun `titles reserve space before participants`() = assertScene(
        """
        scene Sequence 142x218
        edge 28,60 28,210 role=Muted dash=true thick=false head=None tail=None
        edge 115,60 115,210 role=Muted dash=true thick=false head=None tail=None
        text "Flow" at=8,15 anchor=Left role=Text bold=true
        box 8,30 39x30 arc=4 fill=Surface line=Border dash=false
        text "A" at=28,45 anchor=Center role=Text bold=true
        box 95,30 39x30 arc=4 fill=Surface line=Border dash=false
        text "B" at=115,45 anchor=Center role=Text bold=true
        edge 28,138 115,138 role=Line dash=false thick=false head=Arrow tail=None
        text "go" at=71,127 anchor=Center role=Muted bold=false
        """,
        draw("sequenceDiagram\n title Flow\n A->>B: go"),
    )

    private fun draw(source: String) = runBlocking { engine.draw(source, spec()) }
}
