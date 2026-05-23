package ai.kilocode.client.session.views

import ai.kilocode.client.session.model.Question
import ai.kilocode.client.session.model.QuestionItem
import ai.kilocode.client.session.model.QuestionOption
import ai.kilocode.client.session.ui.style.SessionUiStyle
import ai.kilocode.client.session.ui.style.SessionEditorStyle
import ai.kilocode.client.session.views.question.QuestionView
import ai.kilocode.client.ui.HoverIcon
import ai.kilocode.rpc.dto.QuestionReplyDto
import com.intellij.ide.ui.laf.darcula.ui.DarculaButtonUI
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.intellij.ui.EditorTextField
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBRadioButton
import com.intellij.ui.components.JBTextArea
import java.awt.Component
import java.awt.Container
import kotlin.math.abs
import javax.swing.AbstractButton
import javax.swing.JButton
import javax.swing.SwingUtilities

@Suppress("UnstableApiUsage")
class QuestionViewTest : BasePlatformTestCase() {

    private val replies = mutableListOf<Pair<String, QuestionReplyDto>>()
    private val rejects = mutableListOf<String>()
    private var scrolls = 0
    private lateinit var view: QuestionView

    override fun setUp() {
        super.setUp()
        view = QuestionView(
            project = project,
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

    fun `test question action buttons share right-aligned footer group`() {
        view.show(singleSelectQuestion("req_actions"))

        val dismiss = button(view, "Dismiss")
        val submit = button(view, "Submit")
        assertSame("Dismiss and Submit should be in the same right-aligned group", dismiss.parent, submit.parent)
        assertTrue("Dismiss should appear before Submit", dismiss.parent.components.indexOf(dismiss) < submit.parent.components.indexOf(submit))
    }

    fun `test review action buttons share right-aligned footer group`() {
        view.show(twoItemQuestion("req_review_actions"))
        option<JBRadioButton>(view, "Minimal").doClick()
        button(view, "Next").doClick()
        option<JBRadioButton>(view, "Unit").doClick()
        button(view, "Review").doClick()

        val dismiss = button(view, "Dismiss")
        val back = button(view, "Back")
        val submit = button(view, "Submit")
        assertSame("Dismiss and Back should be in the same right-aligned group", dismiss.parent, back.parent)
        assertSame("Back and Submit should be in the same right-aligned group", back.parent, submit.parent)
        assertTrue("Dismiss should appear before Back", dismiss.parent.components.indexOf(dismiss) < back.parent.components.indexOf(back))
        assertTrue("Back should appear before Submit", back.parent.components.indexOf(back) < submit.parent.components.indexOf(submit))
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
        assertEquals("option label should use boldFont", style.boldFont, label.font)
        assertEquals("description should use regularFont", style.regularFont, desc.font)
    }

    fun `test option row without description centers button beside label`() {
        view.show(
            Question(
                id = "no_desc_center",
                items = listOf(
                    QuestionItem(
                        question = "Pick one",
                        header = "Pick",
                        options = listOf(QuestionOption("Plain", "")),
                        multiple = false,
                        custom = false,
                    )
                ),
            )
        )
        layout(view)

        val radio = option<JBRadioButton>(view, "Plain")
        val label = text(view, "Plain")
        val row = label.parent.parent as Container

        val radioCenter = center(radio, row)
        val labelCenter = center(label, row)
        assertTrue(
            "radio should be vertically centered with a single-line label: radio=$radioCenter label=$labelCenter row=${row.size}",
            abs(radioCenter - labelCenter) <= 2,
        )
    }

    fun `test custom row centers button beside label`() {
        view.show(customSingleQuestion("custom_center"))
        layout(view)

        val radio = findAll<JBRadioButton>(view).first { it.actionCommand == "" }
        val label = text(view, "Add your own response")
        val row = label.parent.parent as Container

        val radioCenter = center(radio, row)
        val labelCenter = center(label, row)
        assertTrue(
            "custom radio should be vertically centered with the label: radio=$radioCenter label=$labelCenter row=${row.size}",
            abs(radioCenter - labelCenter) <= 2,
        )
    }

    fun `test question title uses headerFont and hint uses hintFont`() {
        view.show(singleSelectQuestion("q_fonts"))

        val style = SessionEditorStyle.current()
        val title = text(view, "Choose approach")
        val hint = text(view, "Select one answer")

        assertEquals("title should use headerFont", style.headerFont, title.font)
        assertEquals("hint should use hintFont", style.hintFont, hint.font)
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

    fun `test submit has DarculaButtonUI default style key`() {
        view.show(singleSelectQuestion("q_btn_type"))

        val submit = button(view, "Submit")
        assertEquals("Submit should be primary (default style key)", true, submit.getClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY))
    }

    fun `test dismiss does not have default style key`() {
        view.show(singleSelectQuestion("q_dismiss_type"))

        val dismiss = button(view, "Dismiss")
        val key = dismiss.getClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY)
        assertTrue("Dismiss should not be primary", key == null || key == false)
    }

    fun `test session question buttons use question surface background`() {
        view.show(singleSelectQuestion("q_btn_bg"))

        val dismiss = button(view, "Dismiss")
        val submit = button(view, "Submit")

        assertEquals(SessionUiStyle.View.surface(), dismiss.background)
        assertEquals(SessionUiStyle.View.surface(), submit.background)
    }

    fun `test review submit and back buttons have correct primary state on review page`() {
        view.show(twoItemQuestion("q_review_types"))

        option<JBRadioButton>(view, "Minimal").doClick()
        button(view, "Next").doClick()
        option<JBRadioButton>(view, "Unit").doClick()
        button(view, "Review").doClick()

        val submit = button(view, "Submit")
        val back = button(view, "Back")

        assertEquals("Submit on review page should be primary", true, submit.getClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY))
        val backKey = back.getClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY)
        assertTrue("Back on review page should not be primary", backKey == null || backKey == false)
    }

    fun `test next button is not primary before last item`() {
        view.show(twoItemQuestion("q_next_not_primary"))

        val next = button(view, "Next")

        val key = next.getClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY)
        assertTrue("Next should not be primary on first question", key == null || key == false)
    }

    fun `test review button is primary on last item`() {
        view.show(twoItemQuestion("q_review_primary"))
        option<JBRadioButton>(view, "Minimal").doClick()
        button(view, "Next").doClick()

        val review = button(view, "Review")

        assertEquals("Review should be primary on last question", true, review.getClientProperty(DarculaButtonUI.DEFAULT_STYLE_KEY))
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

    // ------ custom question row ------

    fun `test custom row renders when custom is true`() {
        view.show(customSingleQuestion("q_custom_present"))

        assertLabelsContain(view, "Add your own response")
    }

    fun `test custom row is absent when custom is false`() {
        view.show(singleSelectQuestion("q_custom_absent"))

        assertLabelsDoNotContain(view, "Add your own response")
    }

    fun `test custom single select answer submits as typed text`() {
        view.show(customSingleQuestion("q_custom_submit"))

        // Click the custom radio button (actionCommand is "")
        val customRadio = findAll<JBRadioButton>(view).first { it.actionCommand == "" }
        customRadio.doClick()

        // Find the editor that appeared and type text
        val ed = findAll<EditorTextField>(view).first()
        ed.text = "my custom answer"

        button(view, "Submit").doClick()

        assertFalse(view.isVisible)
        assertEquals(1, replies.size)
        assertEquals(listOf(listOf("my custom answer")), replies.single().second.answers)
    }

    fun `test custom editor grows for wrapped input`() {
        view.show(customSingleQuestion("q_custom_grow"))
        layout(view, 240)

        val customRadio = findAll<JBRadioButton>(view).first { it.actionCommand == "" }
        customRadio.doClick()
        layout(view, 240)

        val ed = findAll<EditorTextField>(view).first()
        val initial = ed.preferredSize.height
        ed.text = "wrapped ".repeat(30)

        assertTrue("custom editor should grow when soft-wrapped text needs more lines", ed.preferredSize.height > initial)
    }

    fun `test blank custom input does not enable submit`() {
        view.show(customSingleQuestion("q_custom_blank"))

        val customRadio = findAll<JBRadioButton>(view).first { it.actionCommand == "" }
        customRadio.doClick()

        val submit = button(view, "Submit")
        assertFalse("Submit should remain disabled when custom text is blank", submit.isEnabled)
    }

    fun `test selecting normal option after custom input sends option not custom text`() {
        view.show(customSingleQuestion("q_custom_revert"))

        // Open custom and type something
        val customRadio = findAll<JBRadioButton>(view).first { it.actionCommand == "" }
        customRadio.doClick()
        val ed = findAll<EditorTextField>(view).first()
        ed.text = "stale custom"

        // Now select a normal option
        option<JBRadioButton>(view, "Minimal").doClick()

        button(view, "Submit").doClick()

        assertEquals(listOf(listOf("Minimal")), replies.single().second.answers)
    }

    fun `test selecting normal option after custom input clears custom radio selection`() {
        view.show(customSingleQuestion("q_custom_clear_radio"))

        val radio = findAll<JBRadioButton>(view).first { it.actionCommand == "" }
        radio.doClick()
        val ed = findAll<EditorTextField>(view).first()
        ed.text = "stale custom"

        option<JBRadioButton>(view, "Minimal").doClick()

        val custom = findAll<JBRadioButton>(view).first { it.actionCommand == "" }
        assertFalse("Custom radio should not stay selected after choosing a normal option", custom.isSelected)
        assertTrue("Normal option should be selected", option<JBRadioButton>(view, "Minimal").isSelected)
        assertTrue("Custom editor should stay visible for non-empty text", findAll<EditorTextField>(view).any { it.parent != null && it.text == "stale custom" })
        assertLabelsDoNotContain(view, "stale custom")
    }

    fun `test empty custom editor is removed after selecting normal option`() {
        view.show(customSingleQuestion("q_custom_empty_editor"))

        findAll<JBRadioButton>(view).first { it.actionCommand == "" }.doClick()
        assertNotNull(findAll<EditorTextField>(view).firstOrNull { it.parent != null })

        option<JBRadioButton>(view, "Minimal").doClick()

        assertNull("Empty custom editor should be removed after selecting a normal option", findAll<EditorTextField>(view).firstOrNull { it.parent != null })
    }

    fun `test focusing retained custom editor reselects custom response`() {
        view.show(customSingleQuestion("q_custom_focus"))

        findAll<JBRadioButton>(view).first { it.actionCommand == "" }.doClick()
        findAll<EditorTextField>(view).first().text = "stale custom"
        option<JBRadioButton>(view, "Minimal").doClick()

        view.testFocusCustomEditor()

        assertTrue("Custom radio should be selected when its editor takes focus", findAll<JBRadioButton>(view).first { it.actionCommand == "" }.isSelected)
        assertFalse("Normal option should be cleared when custom editor takes focus", option<JBRadioButton>(view, "Minimal").isSelected)
        assertEquals("Submit should send custom text after focusing retained editor", listOf(listOf("stale custom")), run {
            button(view, "Submit").doClick()
            replies.single().second.answers
        })
    }

    fun `test multi select custom answer combines with selected options`() {
        view.show(customMultiQuestion("q_multi_custom"))

        option<JBCheckBox>(view, "A").doClick()
        val customBox = findAll<JBCheckBox>(view).first { it.actionCommand == "" }
        customBox.doClick()
        val ed = findAll<EditorTextField>(view).first()
        ed.text = "extra"

        button(view, "Review").doClick()
        button(view, "Submit").doClick()

        assertEquals(listOf(listOf("A", "extra")), replies.single().second.answers)
    }

    fun `test custom input is trimmed before submit`() {
        view.show(customSingleQuestion("q_custom_trim"))

        findAll<JBRadioButton>(view).first { it.actionCommand == "" }.doClick()
        findAll<EditorTextField>(view).first().text = "  trimmed answer  "

        button(view, "Submit").doClick()

        assertEquals(listOf(listOf("trimmed answer")), replies.single().second.answers)
    }

    fun `test multi select custom answer can be unchecked`() {
        view.show(customMultiQuestion("q_multi_custom_unchecked"))

        option<JBCheckBox>(view, "A").doClick()
        findAll<JBCheckBox>(view).first { it.actionCommand == "" }.doClick()
        findAll<EditorTextField>(view).first().text = "extra"

        findAll<JBCheckBox>(view).first { it.actionCommand == "" }.doClick()

        assertFalse(
            "Custom checkbox should be unchecked",
            findAll<JBCheckBox>(view).first { it.actionCommand == "" }.isSelected,
        )
        assertTrue("Review should stay enabled because a normal option is selected", button(view, "Review").isEnabled)
        button(view, "Review").doClick()
        assertLabelsContain(view, "A")
        assertLabelsDoNotContain(view, "extra")

        button(view, "Submit").doClick()

        assertEquals(listOf(listOf("A")), replies.single().second.answers)
    }

    fun `test duplicate custom answer is submitted once`() {
        view.show(customMultiQuestion("q_multi_custom_duplicate"))

        option<JBCheckBox>(view, "A").doClick()
        findAll<JBCheckBox>(view).first { it.actionCommand == "" }.doClick()
        findAll<EditorTextField>(view).first().text = "A"

        button(view, "Review").doClick()
        button(view, "Submit").doClick()

        assertEquals(listOf(listOf("A")), replies.single().second.answers)
    }

    fun `test custom text appears in review`() {
        view.show(
            Question(
                id = "q_custom_review",
                items = listOf(
                    QuestionItem(
                        question = "How?",
                        header = "H",
                        options = listOf(QuestionOption("X", "")),
                        multiple = false,
                        custom = true,
                    ),
                    QuestionItem(
                        question = "What?",
                        header = "W",
                        options = listOf(QuestionOption("Y", "")),
                        multiple = false,
                        custom = false,
                    ),
                ),
            )
        )

        // Answer first with custom
        val customRadio = findAll<JBRadioButton>(view).first { it.actionCommand == "" }
        customRadio.doClick()
        val ed = findAll<EditorTextField>(view).first()
        ed.text = "typed answer"

        button(view, "Next").doClick()
        option<JBRadioButton>(view, "Y").doClick()
        button(view, "Review").doClick()

        assertLabelsContain(view, "typed answer")
    }

    fun `test custom text preserved across navigation`() {
        view.show(
            Question(
                id = "q_custom_nav",
                items = listOf(
                    QuestionItem(
                        question = "How?",
                        header = "H",
                        options = listOf(QuestionOption("X", "")),
                        multiple = false,
                        custom = true,
                    ),
                    QuestionItem(
                        question = "What?",
                        header = "W",
                        options = listOf(QuestionOption("Y", "")),
                        multiple = false,
                        custom = false,
                    ),
                ),
            )
        )

        // Open custom on first question and type
        val customRadio = findAll<JBRadioButton>(view).first { it.actionCommand == "" }
        customRadio.doClick()
        val ed = findAll<EditorTextField>(view).first()
        ed.text = "preserved text"

        // Navigate forward
        button(view, "Next").doClick()
        option<JBRadioButton>(view, "Y").doClick()

        // Navigate back
        navButton(view, "Back").doClick()

        // Custom row should still be open with the preserved text in the editor
        val editorAfterBack = findAll<EditorTextField>(view).firstOrNull()
        assertNotNull("Custom editor should still be visible after navigating back", editorAfterBack)
        assertEquals("Custom editor should have preserved text", "preserved text", editorAfterBack!!.text)
    }

    fun `test optionless custom question is answerable`() {
        view.show(
            Question(
                id = "q_optionless",
                items = listOf(
                    QuestionItem(
                        question = "Free answer",
                        header = "Free",
                        options = emptyList(),
                        multiple = false,
                        custom = true,
                    )
                ),
            )
        )

        // The custom row should be present
        assertLabelsContain(view, "Add your own response")

        // Open the custom row
        val customRadio = findAll<JBRadioButton>(view).first { it.actionCommand == "" }
        customRadio.doClick()

        val ed = findAll<EditorTextField>(view).first()
        ed.text = "my answer"

        val submit = button(view, "Submit")
        assertTrue("Submit should be enabled after typing in optionless custom question", submit.isEnabled)

        submit.doClick()

        assertFalse(view.isVisible)
        assertEquals(listOf(listOf("my answer")), replies.single().second.answers)
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

    private fun layout(root: Container, width: Int = 400) {
        root.setSize(width, root.preferredSize.height)
        layoutTree(root)
    }

    private fun layoutTree(root: Container) {
        root.doLayout()
        for (child in root.components) {
            if (child is Container) layoutTree(child)
        }
    }

    private fun center(component: Component, root: Component): Int =
        SwingUtilities.convertPoint(component, 0, component.height / 2, root).y

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

    private fun customSingleQuestion(id: String) = Question(
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
                custom = true,
            )
        ),
    )

    private fun customMultiQuestion(id: String) = Question(
        id = id,
        items = listOf(
            QuestionItem(
                question = "Pick features",
                header = "Features",
                options = listOf(QuestionOption("A", ""), QuestionOption("B", "")),
                multiple = true,
                custom = true,
            )
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
