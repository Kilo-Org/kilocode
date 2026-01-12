# Implementation Plan: Chat Bubble UI System

## Overview

This implementation plan transforms the chat interface from a flat message layout to a modern bubble-style UI. The implementation follows an incremental approach, creating the core MessageBubble component first, then integrating it with the existing ChatRow component.

## Tasks

- [x]   1. Set up MessageBubble component structure

    - Create `webview-ui/src/components/chat/MessageBubble/` directory
    - Create index.ts, MessageBubble.tsx, bubbleStyles.ts, bubbleUtils.ts files
    - Define TypeScript interfaces for MessageBubbleProps and BubbleStyleConfig
    - _Requirements: 1.1, 2.1, 3.1_

- [x]   2. Implement bubble styling configuration

    - [x] 2.1 Create bubbleStyles.ts with BUBBLE_STYLES configuration

        - Define style configs for user, ai, and system variants
        - Use Tailwind classes referencing VSCode CSS variables
        - Include alignment, background, border-radius, and padding classes
        - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2, 6.1, 6.4_

    - [ ]\* 2.2 Write property test for variant-based styling
        - **Property 1: Variant-Based Styling Consistency**
        - **Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2**

- [x]   3. Implement bubble utility functions

    - [x] 3.1 Create bubbleUtils.ts with getBubbleVariant function

        - Implement logic to determine variant from ClineMessage type
        - Handle user messages (ask types), AI messages (say text), system messages (tools, commands)
        - _Requirements: 1.1, 2.1, 3.1_

    - [ ]\* 3.2 Write property test for theme variable usage
        - **Property 4: Theme Variable Usage**
        - **Validates: Requirements 6.1, 6.4**

- [x]   4. Implement BubbleContainer component

    - [x] 4.1 Create BubbleContainer.tsx

        - Implement base container with alignment and styling props
        - Apply Tailwind classes from bubbleStyles configuration
        - Support hover effects and transitions
        - _Requirements: 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 5.1_

    - [ ]\* 4.2 Write property test for spacing based on grouping
        - **Property 2: Spacing Based on Grouping State**
        - **Validates: Requirements 4.1, 4.2, 4.3**

- [x]   5. Implement MessageBubble component

    - [x] 5.1 Create MessageBubble.tsx main component

        - Accept variant, isGrouped, isStreaming, isHighlighted, isEditing props
        - Render BubbleContainer with appropriate styling
        - Handle children content rendering
        - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.2_

    - [ ]\* 5.2 Write property test for state-based visual indicators

        - **Property 3: State-Based Visual Indicators**
        - **Validates: Requirements 1.5, 2.5, 5.1, 5.2**

    - [ ]\* 5.3 Write property test for max-width constraints
        - **Property 7: Maximum Width Constraints**
        - **Validates: Requirements 4.4**

- [x]   6. Add accessibility support

    - [x] 6.1 Add ARIA attributes to MessageBubble

        - Add role="article" or appropriate role
        - Add aria-label describing message type and sender
        - Ensure keyboard focusability for interactive elements
        - _Requirements: 7.2, 7.3_

    - [ ]\* 6.2 Write property test for accessibility attributes
        - **Property 5: Accessibility Attributes**
        - **Validates: Requirements 7.3**

- [x]   7. Add CSS animations and effects

    - [x] 7.1 Add bubble-specific CSS to kilocode.css
        - Add streaming indicator animation (bubble-pulse)
        - Add hover transition effects
        - Add reduced-motion media query support
        - _Requirements: 2.5, 5.1, 7.4_

- [x]   8. Checkpoint - Ensure all tests pass

    - Ensure all tests pass, ask the user if questions arise.

- [x]   9. Integrate MessageBubble with ChatRow

    - [x] 9.1 Modify ChatRow to use MessageBubble

        - Import MessageBubble component
        - Wrap ChatRowContent with MessageBubble
        - Pass appropriate variant based on message type
        - Pass isGrouped based on previous message sender
        - _Requirements: 1.1, 2.1, 3.1, 4.1, 4.2_

    - [ ]\* 9.2 Write property test for efficient CSS implementation
        - **Property 6: Efficient CSS Implementation**
        - **Validates: Requirements 8.4**

- [x]   10. Handle special message types

    - [x] 10.1 Style user messages with images

        - Ensure images render within bubble container
        - Maintain bubble styling with image thumbnails
        - _Requirements: 1.4_

    - [ ]\* 10.2 Write property test for image containment

        - **Property 8: Image Content Containment**
        - **Validates: Requirements 1.4**

    - [x] 10.3 Style error messages
        - Apply error-themed colors for error messages
        - Use VSCode error foreground variable
        - _Requirements: 3.4_

- [x]   11. Handle edit mode styling

    - [x] 11.1 Add edit mode visual indicators
        - Show edit border/background when isEditing is true
        - Ensure edit controls render within bubble
        - _Requirements: 1.5, 5.4_

- [x]   12. Final checkpoint - Ensure all tests pass
    - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use fast-check library for property-based testing
- All styling uses Tailwind CSS with VSCode CSS variables
- The implementation maintains backward compatibility with existing ChatRow functionality
