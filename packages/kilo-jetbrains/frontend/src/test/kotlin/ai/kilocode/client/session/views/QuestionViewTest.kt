package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Question
import ai.kilocode.client.session.model.QuestionItem
import ai.kilocode.client.session.model.QuestionOption
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.views.question.QuestionView
import ai.kilocode.client.ui.HoverIcon
import ai.kilocode.rpc.dto.QuestionReplyDto
import com.intellij.ide.ui.laf.darcula.ui.DarculaButtonUI
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBRadioButton
import com.intellij.ui.components.JBTextArea
import java.awt.Container
import javax.swing.AbstractButton
import javax.swing.JButton

@Suppress("UnstableApiUsage")
class QuestionViewTest : BasePlatformTestCase() {

    private val replies = mutableListOf<Pair<String, QuestionReplyDto>>()
    private val rejects = mutableListOf<String>()
    private var scrolls = 0
    private lateinit var view: QuestionView

    override fun setUp() {
        super.setUp()
        view = QuestionView(
            reply = { id, dto -> replies.add(id to dto) },
            reject = { id -> rejects.add(id) },
            scroll = { scrolls++ },
        )
    }

    // ------ empty question ------

    fun `test empty question hides view and clears stale request id`() {
        view.show(
            Question(
                id = "req_old",
                items = listOf(
                    QuestionItem(
                        question = "Pick one",
                        header = "Header",
                        options = listOf(QuestionOption("Yes", "desc")),
                        multiple = false,
                        custom = true,
                    )
                ),
            )
        )
        assertTrue(view.isVisible)

        view.show(Question(id = "req_new", items = emptyList()))

        assertFalse(view.isVisible)
        assertTrue(replies.isEmpty())
        assertTrue(rejects.isEmpty())
    }

    // ------ dismiss ------

    fun `test dismiss button uses bundle text and rejects question`() {
        view.show(
            Question(
                id = "req_1",
                items = listOf(
                    QuestionItem(
                        question = "Pick one",
                        header = "Header",
                        options = listOf(QuestionOption("Yes", "desc")),
                        multiple = false,
                        custom = true,
                    )
                ),
            )
        )

        button(view, "Dismiss").doClick()

        assertFalse(view.isVisible)
        assertEquals("req_1", rejects.single())
        assertTrue(replies.isEmpty())
    }

    // ------ radio options ------

    fun `test single question renders radio options`() {
        view.show(singleSelectQuestion("req_r"))

        val radios = findAll<JBRadioButton>(view)
        assertEquals(2, radios.size)
        assertEquals("Minimal", radios[0].actionCommand)
        assertEquals("Balanced", radios[1].actionCommand)
        assertTrue(findAll<JBCheckBox>(view).isEmpty())
    }

    fun `test single question submit sends selected answer`() {
        view.show(singleSelectQuestion("req_2"))

        // Select via radio button
        option<JBRadioButton>(view, "Minimal").doClick()
        button(view, "Submit").doClick()

        assertFalse(view.isVisible)
        assertEquals(1, replies.size)
        assertEquals("req_2", replies.single().first)
        assertEquals(listOf(listOf("Minimal")), replies.single().second.answers)
    }

    fun `test submit is disabled until question is answered`() {
        view.show(singleSelectQuestion("req_required"))

        val submit = button(view, "Submit")
        assertFalse("Submit should be disabled before selection", submit.isEnabled)

        submit.doClick()
        assertTrue("Disabled submit should not send a reply", replies.isEmpty())

        option<JBRadioButton>(view, "Minimal").doClick()
        assertTrue("Submit should be enabled after selection", submit.isEnabled)
    }

    // ------ option label and description ------

    fun `test option row aligns label and description beside button`() {
        view.show(
            Question(
                id = "desc_test",
                items = listOf(
                    QuestionItem(
                        question = "How to proceed?",
                        header = "Approach",
                        options = listOf(
                            QuestionOption("Minimal", "Smallest safe change"),
                        ),
                        multiple = false,
                        custom = false,
                    )
                ),
            )
        )

        val radio = option<JBRadioButton>(view, "Minimal")
        assertTrue("radio should keep text in aligned renderer", radio.text.isNullOrEmpty())

        val label = findAll<JBTextArea>(view).firstOrNull { it.text == "Minimal" }
        assertNotNull("option label should be present", label)
        assertTrue("option label should be bold", label!!.font.isBold)
        assertTrue("option label should wrap", label.lineWrap)

        val desc = findAll<JBTextArea>(view).firstOrNull { it.text == "Smallest safe change" }
        assertNotNull("description should be present", desc)
        assertTrue("description should wrap", desc!!.lineWrap)
        assertEquals("description should align in the text renderer", label.parent, desc.parent)

        val style = SessionEditorStyle.current()
        assertEquals("option label should use bold editor font", style.boldEditorFont, label.font)
        assertEquals("description should use transcript font", style.transcriptFont, desc.font)
    }

    fun `test question title and hint use editor fonts`() {
        view.show(singleSelectQuestion("q_fonts"))

        val style = SessionEditorStyle.current()
        val title = text(view, "Choose approach")
        val hint = text(view, "Select one answer")

        assertEquals(style.boldEditorFont, title.font)
        assertEquals(style.transcriptFont, hint.font)
    }

    // ------ multi-question navigation ------

    fun `test multi question shows one question at a time and navigates`() {
        view.show(twoItemQuestion("q_nav"))

        // First question shown, second not
        assertLabelsContain(view, "Choose approach")
        assertLabelsDoNotContain(view, "Choose test level")
        assertLabelsContain(view, "1 of 2 questions")

        // Select an answer on first question, then click Next
        option<JBRadioButton>(view, "Minimal").doClick()
        button(view, "Next").doClick()

        // Second question shown, first not
        assertLabelsContain(view, "Choose test level")
        assertLabelsDoNotContain(view, "Choose approach")
        assertLabelsContain(view, "2 of 2 questions")

        // Select answer on second question, click Review
        option<JBRadioButton>(view, "Unit").doClick()
        button(view, "Review").doClick()

        // Review page shown
        assertLabelsContain(view, "Review your answers")
        assertLabelsContain(view, "Choose approach")
        assertLabelsContain(view, "Minimal")
        assertLabelsContain(view, "Choose test level")
        assertLabelsContain(view, "Unit")

        // Submit from review page
        button(view, "Submit").doClick()

        assertFalse(view.isVisible)
        assertEquals(1, replies.size)
        assertEquals("q_nav", replies.single().first)
        assertEquals(listOf(listOf("Minimal"), listOf("Unit")), replies.single().second.answers)
    }

    fun `test multi question uses review before submit`() {
        view.show(twoItemQuestion("q_review"))

        option<JBRadioButton>(view, "Minimal").doClick()
        button(view, "Next").doClick()
        option<JBRadioButton>(view, "Unit").doClick()

        // Clicking Review should NOT submit
        button(view, "Review").doClick()

        assertTrue("Should still be visible after Review", view.isVisible)
        assertTrue("No replies should be sent after Review", replies.isEmpty())

        // Now submit from review page
        button(view, "Submit").doClick()

        assertFalse(view.isVisible)
        assertEquals(1, replies.size)
    }

    fun `test back preserves previous selection`() {
        view.show(twoItemQuestion("q_back"))

        // Answer first question
        option<JBRadioButton>(view, "Minimal").doClick()
        button(view, "Next").doClick()

        // Go back via header nav icon
        navButton(view, "Back").doClick()

        // First question visible again, selection preserved
        assertLabelsContain(view, "Choose approach")
        assertLabelsContain(view, "1 of 2 questions")
        val radios = findAll<JBRadioButton>(view)
        assertTrue("Minimal should still be selected", radios.first { it.actionCommand == "Minimal" }.isSelected)

        // Change selection to Balanced, go forward, then to review
        option<JBRadioButton>(view, "Balanced").doClick()
        button(view, "Next").doClick()
        option<JBRadioButton>(view, "Unit").doClick()
        button(view, "Review").doClick()
        button(view, "Submit").doClick()

        assertEquals(listOf(listOf("Balanced"), listOf("Unit")), replies.single().second.answers)
    }

    fun `test review back preserves answers`() {
        view.show(twoItemQuestion("q_review_back"))

        option<JBRadioButton>(view, "Minimal").doClick()
        button(view, "Next").doClick()
        option<JBRadioButton>(view, "Unit").doClick()
        button(view, "Review").doClick()

        // On review page - go back to last question
        button(view, "Back").doClick()

        // Back on second question — selection should be preserved
        assertLabelsContain(view, "Choose test level")
        assertLabelsContain(view, "2 of 2 questions")
        val radios = findAll<JBRadioButton>(view)
        assertTrue("Unit should still be selected", radios.first { it.actionCommand == "Unit" }.isSelected)
    }

    fun `test review displays multi select answers joined`() {
        val q = Question(
            id = "q_multi",
            items = listOf(
                QuestionItem(
                    question = "Choose features",
                    header = "Features",
                    options = listOf(
                        QuestionOption("A", "Feature A"),
                        QuestionOption("B", "Feature B"),
                    ),
                    multiple = true,
                    custom = false,
                ),
            ),
        )
        view.show(q)

        option<JBCheckBox>(view, "A").doClick()
        option<JBCheckBox>(view, "B").doClick()
        button(view, "Review").doClick()

        assertLabelsContain(view, "A, B")
    }

    fun `test single select question still submits directly`() {
        view.show(singleSelectQuestion("q_direct"))

        option<JBRadioButton>(view, "Minimal").doClick()
        button(view, "Submit").doClick()

        // Should submit directly without a review step
        assertFalse(view.isVisible)
        assertEquals(1, replies.size)
        assertEquals(listOf(listOf("Minimal")), replies.single().second.answers)
    }

    fun `test next is disabled until current question is answered`() {
        view.show(twoItemQuestion("q_disabled"))

        val next = button(view, "Next")
        assertFalse("Next should be disabled before selection", next.isEnabled)

        option<JBRadioButton>(view, "Minimal").doClick()

        val nextAfter = button(view, "Next")
        assertTrue("Next should be enabled after selection", nextAfter.isEnabled)
    }

    fun `test selection updates existing footer controls`() {
        view.show(twoItemQuestion("q_retained"))

        val next = button(view, "Next")

        option<JBRadioButton>(view, "Minimal").doClick()

        assertSame("selection should not rebuild the footer button", next, button(view, "Next"))
        assertTrue("existing Next button should be enabled", next.isEnabled)
    }

    fun `test header nav disables unavailable directions`() {
        view.show(twoItemQuestion("q_nav_disabled"))

        assertFalse("Back should be disabled on first question", navButton(view, "Back").isEnabled)
        assertNotNull("Back should have disabled icon", navButton(view, "Back").disabledIcon)
        assertFalse("Forward should be disabled before selection", navButton(view, "Next").isEnabled)
        assertNotNull("Forward should have disabled icon", navButton(view, "Next").disabledIcon)

        option<JBRadioButton>(view, "Minimal").doClick()
        assertTrue("Forward should be enabled after selection on first question", navButton(view, "Next").isEnabled)

        button(view, "Next").doClick()

        assertTrue("Back should be enabled on second question", navButton(view, "Back").isEnabled)
        // Forward on last question is enabled only after selection (can go to review)
        assertFalse("Forward should be disabled on last question before selection", navButton(view, "Next").isEnabled)

        option<JBRadioButton>(view, "Unit").doClick()
        assertTrue("Forward should be enabled on last question after selection (goes to review)", navButton(view, "Next").isEnabled)
    }

    fun `test submit button uses default style`() {
        view.show(singleSelectQuestion("q_default"))

        val submit = button(view, "Submit")

        assertEquals(true, submit.getClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY))
    }

    fun `test single question hides header nav`() {
        view.show(singleSelectQuestion("q_single"))

        assertTrue(findAll<HoverIcon>(view).all { !it.parent.isVisible })
    }

    fun `test selection requests scroll to bottom`() {
        view.show(singleSelectQuestion("q_scroll"))

        option<JBRadioButton>(view, "Minimal").doClick()

        assertEquals(1, scrolls)
    }

    fun `test question navigation requests scroll to bottom`() {
        view.show(twoItemQuestion("q_nav_scroll"))

        option<JBRadioButton>(view, "Minimal").doClick()
        button(view, "Next").doClick()
        navButton(view, "Back").doClick()

        assertEquals(3, scrolls)
    }

    // ------ multi-select checkboxes ------

    fun `test multiple selection item uses checkboxes and toggles options`() {
        view.show(
            Question(
                id = "req_3",
                items = listOf(
                    QuestionItem(
                        question = "Select features",
                        header = "Features",
                        options = listOf(
                            QuestionOption("A", "Feature A"),
                            QuestionOption("B", "Feature B"),
                            QuestionOption("C", "Feature C"),
                        ),
                        multiple = true,
                        custom = false,
                    )
                ),
            )
        )

        val boxes = findAll<JBCheckBox>(view)
        assertEquals(3, boxes.size)
        assertTrue(findAll<JBRadioButton>(view).isEmpty())

        boxes.first { it.actionCommand == "A" }.doClick()
        boxes.first { it.actionCommand == "B" }.doClick()
        option<JBCheckBox>(view, "B").doClick()

        // Single multi-select item gets a Review step (VS Code parity: single() is false when multiple=true)
        button(view, "Review").doClick()
        button(view, "Submit").doClick()

        assertFalse(view.isVisible)
        assertEquals(1, replies.size)
        assertEquals("req_3", replies.single().first)
        assertEquals(listOf(listOf("A")), replies.single().second.answers)
    }

    // ------ helpers ------

    /**
     * Find a [JButton] by button text — covers footer buttons (Dismiss, Next, Submit, Review, Back).
     * For icon-only nav buttons (Back/Forward) that use tooltip, use [navButton].
     */
    private fun button(root: Container, text: String): JButton =
        findAll<JButton>(root).first { it.text == text }

    /** Find a [HoverIcon] nav button by tooltip text (Back / Next nav arrows). */
    private fun navButton(root: Container, tooltip: String): HoverIcon =
        findAll<HoverIcon>(root).first { it.toolTipText == tooltip }

    private inline fun <reified T : AbstractButton> option(root: Container, label: String): T =
        findAll<T>(root).first { it.actionCommand == label }

    private fun text(root: Container, value: String): JBTextArea =
        findAll<JBTextArea>(root).first { it.text == value }

    private fun singleSelectQuestion(id: String) = Question(
        id = id,
        items = listOf(
            QuestionItem(
                question = "Choose approach",
                header = "Approach",
                options = listOf(
                    QuestionOption("Minimal", "Smallest safe change"),
                    QuestionOption("Balanced", "Focused implementation with tests"),
                ),
                multiple = false,
                custom = false,
            )
        ),
    )

    private fun twoItemQuestion(id: String) = Question(
        id = id,
        items = listOf(
            QuestionItem(
                question = "Choose approach",
                header = "Approach",
                options = listOf(
                    QuestionOption("Minimal", "Smallest safe change"),
                    QuestionOption("Balanced", "Focused implementation"),
                ),
                multiple = false,
                custom = false,
            ),
            QuestionItem(
                question = "Choose test level",
                header = "Test Level",
                options = listOf(
                    QuestionOption("Unit", "Unit tests"),
                    QuestionOption("Integration", "Integration tests"),
                ),
                multiple = false,
                custom = false,
            ),
        ),
    )

    private fun assertLabelsContain(root: Container, text: String) {
        val found = findAll<JBLabel>(root).any { it.text == text } || findAll<JBTextArea>(root).any { it.text == text }
        assertTrue("Expected label '$text' to be present", found)
    }

    private fun assertLabelsDoNotContain(root: Container, text: String) {
        val found = findAll<JBLabel>(root).any { it.text == text } || findAll<JBTextArea>(root).any { it.text == text }
        assertFalse("Expected label '$text' to be absent, but it was found", found)
    }

    private inline fun <reified T> findAll(root: Container): List<T> = findAllCls(root, T::class.java)

    /**
     * Recursively find all components of type [cls], but do NOT recurse into
     * [AbstractButton] subtypes — buttons may have internal sub-components
     * (e.g. IntelliJ UI delegate children) that would produce spurious matches.
     */
    private fun <T> findAllCls(root: Container, cls: Class<T>): List<T> {
        val result = mutableListOf<T>()
        if (cls.isInstance(root)) result.add(cls.cast(root))
        for (child in root.components) {
            if (cls.isInstance(child)) result.add(cls.cast(child))
            // Do not recurse into button internals to avoid double-counting
            if (child is Container && child !is AbstractButton) {
                result.addAll(findAllCls(child, cls))
            }
        }
        return result
    }
}
