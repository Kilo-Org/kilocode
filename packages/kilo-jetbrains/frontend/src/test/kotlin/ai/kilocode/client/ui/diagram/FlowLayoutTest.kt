package ai.kilocode.client.ui.diagram

import ai.kilocode.client.ui.diagram.mermaid.Mermaid
import kotlinx.coroutines.runBlocking
import kotlin.test.Test

class FlowLayoutTest {
    private val engine = Mermaid(FakeMeasure())

    @Test
    fun `two nodes stack vertically`() = assertScene(
        """
        scene Flowchart 39x124
        edge 20,38 20,86 role=Line dash=false thick=false head=Arrow tail=None
        box 8,8 23x30 arc=0 fill=Surface line=Border dash=false
        text "A" at=20,23 anchor=Center role=Text bold=false
        box 8,86 23x30 arc=0 fill=Surface line=Border dash=false
        text "B" at=20,101 anchor=Center role=Text bold=false
        """,
        draw("flowchart TD\n A --> B"),
    )

    @Test
    fun `branches route labelled links`() = assertScene(
        """
        scene Flowchart 114x218
        edge 54,38 54,86 role=Line dash=false thick=false head=Arrow tail=None
        edge 45,132 28,180 role=Line dash=false thick=false head=Arrow tail=None
        text "yes" at=37,156 anchor=Center role=Muted bold=false
        edge 62,132 79,180 role=Line dash=false thick=false head=Arrow tail=None
        text "no" at=70,156 anchor=Center role=Muted bold=false
        box 28,8 51x30 arc=0 fill=Surface line=Border dash=false
        text "Start" at=54,23 anchor=Center role=Text bold=false
        poly 54,86 80,109 54,132 27,109 fill=Surface line=Border
        text "Ok?" at=54,109 anchor=Center role=Text bold=false
        box 8,180 30x30 arc=0 fill=Surface line=Border dash=false
        text "Go" at=23,195 anchor=Center role=Text bold=false
        box 62,180 44x30 arc=0 fill=Surface line=Border dash=false
        text "Stop" at=84,195 anchor=Center role=Text bold=false
        """,
        draw("flowchart TD\n A[Start] --> B{Ok?}\n B -->|yes| C[Go]\n B -->|no| D[Stop]"),
    )

    @Test
    fun `self links render as loops`() = assertScene(
        """
        scene Flowchart 51x46
        edge 31,16 43,16 43,31 31,31 role=Line dash=false thick=false head=Arrow tail=None
        box 8,8 23x30 arc=0 fill=Surface line=Border dash=false
        text "A" at=20,23 anchor=Center role=Text bold=false
        """,
        draw("flowchart TD\n A --> A"),
    )

    @Test
    fun `direction transforms are applied after layout`() = assertScene(
        """
        scene Flowchart 110x46
        edge 31,23 79,23 role=Line dash=false thick=false head=Arrow tail=None
        box 8,8 23x30 arc=0 fill=Surface line=Border dash=false
        text "A" at=20,23 anchor=Center role=Text bold=false
        box 79,8 23x30 arc=0 fill=Surface line=Border dash=false
        text "B" at=91,23 anchor=Center role=Text bold=false
        """,
        draw("flowchart LR\n A --> B"),
    )

    @Test
    fun `clusters emit grouped dashed frames`() = assertScene(
        """
        scene Flowchart 55x210
        group s
          box 0,56 55x154 arc=4 fill=- line=Cluster dash=true
          text "Group" at=28,71 anchor=Center role=Muted bold=true
        edge 28,38 28,86 role=Line dash=false thick=false head=Arrow tail=None
        edge 28,116 28,164 role=Line dash=false thick=false head=Arrow tail=None
        box 16,8 23x30 arc=0 fill=Surface line=Border dash=false
        text "A" at=28,23 anchor=Center role=Text bold=false
        box 16,86 23x30 arc=0 fill=Surface line=Border dash=false
        text "B" at=28,101 anchor=Center role=Text bold=false
        box 16,164 23x30 arc=0 fill=Surface line=Border dash=false
        text "C" at=28,179 anchor=Center role=Text bold=false
        """,
        draw("flowchart TD\n A --> B\n subgraph s [Group]\n B --> C\n end"),
    )

    private fun draw(source: String) = runBlocking { engine.draw(source, spec()) }
}
