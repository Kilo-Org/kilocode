# Tasks: Next Edit

**Input**: Design documents from `/specs/001-next-edit/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are included as per Kilo Code TDD requirement - write tests before implementation.

**Organization**: Tasks are grouped by functional requirement priority to enable independent implementation and testing of each requirement group.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which requirement group this task belongs to (e.g., P1, P2, P3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- **Webview UI**: `webview-ui/src/`
- Paths shown below follow the Kilo Code monorepo structure

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create service directory structure in src/services/next-edit/
- [x] T002 [P] Create test directory structure in tests/services/next-edit/
- [x] T003 [P] Add simple-git dependency to package.json if not present
- [x] T004 [P] Add uuid dependency to package.json if not present

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY requirement group can be implemented

**⚠️ CRITICAL**: No requirement group work can begin until this phase is complete

- [x] T005 Create shared types file in src/services/next-edit/types.ts with all enums and interfaces from data-model.md
- [x] T006 [P] Create error types file in src/services/next-edit/errors.ts with NextEditError and ErrorCodes
- [x] T007 [P] Create utility functions file in src/services/next-edit/utils.ts for UUID generation and validation
- [x] T008 Create SessionStorage service stub in src/services/next-edit/SessionStorage.ts
- [x] T009 Create EditAnalyzer service stub in src/services/next-edit/EditAnalyzer.ts
- [x] T010 Create EditSequencer service stub in src/services/next-edit/EditSequencer.ts
- [x] T011 Create EditExecutor service stub in src/services/next-edit/EditExecutor.ts
- [x] T012 Create NextEditSession service stub in src/services/next-edit/NextEditSession.ts

**Checkpoint**: Foundation ready - requirement group implementation can now begin in parallel

---

## Phase 3: Requirement Group P1 - Core Session & Edit Management (Priority: Must Have) 🎯 MVP

**Goal**: Enable users to start sessions, analyze codebase, and review/apply edits sequentially

**Independent Test**: User can start a session, see edit suggestions, review diffs, and accept/skip edits

### Tests for Requirement Group P1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T013 [P] [P1] Unit test for SessionStorage in tests/services/next-edit/SessionStorage.spec.ts
- [x] T014 [P] [P1] Unit test for EditAnalyzer in tests/services/next-edit/EditAnalyzer.spec.ts
- [x] T015 [P] [P1] Unit test for EditSequencer in tests/services/next-edit/EditSequencer.spec.ts
- [x] T016 [P] [P1] Unit test for EditExecutor in tests/services/next-edit/EditExecutor.spec.ts
- [x] T017 [P] [P1] Unit test for NextEditSession in tests/services/next-edit/NextEditSession.spec.ts
- [x] T018 [P] [P1] Integration test for session lifecycle in tests/services/next-edit/integration.spec.ts

### Implementation for Requirement Group P1

- [x] T019 [P1] Implement SessionStorage.saveSession in src/services/next-edit/SessionStorage.ts
- [x] T020 [P1] Implement SessionStorage.loadSession in src/services/next-edit/SessionStorage.ts
- [x] T021 [P1] Implement SessionStorage.deleteSession in src/services/next-edit/SessionStorage.ts
- [x] T022 [P1] Implement SessionStorage.getActiveSessionId in src/services/next-edit/SessionStorage.ts
- [x] T023 [P1] Implement EditAnalyzer.analyzeCodebase in src/services/next-edit/EditAnalyzer.ts
- [x] T024 [P1] Implement EditAnalyzer.generateEditSuggestions in src/services/next-edit/EditAnalyzer.ts
- [x] T025 [P1] Implement EditAnalyzer.calculateConfidence in src/services/next-edit/EditAnalyzer.ts
- [x] T026 [P1] Implement EditSequencer.sequenceEdits in src/services/next-edit/EditSequencer.ts
- [x] T027 [P1] Implement EditSequencer.resolveDependencies in src/services/next-edit/EditSequencer.ts
- [x] T028 [P1] Implement EditSequencer.detectCircularDependencies in src/services/next-edit/EditSequencer.ts
- [x] T029 [P1] Implement EditExecutor.applyEdit in src/services/next-edit/EditExecutor.ts
- [x] T030 [P1] Implement EditExecutor.generateDiff in src/services/next-edit/EditExecutor.ts
- [x] T031 [P1] Implement NextEditSession.start in src/services/next-edit/NextEditSession.ts
- [x] T032 [P1] Implement NextEditSession.getNextEdit in src/services/next-edit/NextEditSession.ts
- [x] T033 [P1] Implement NextEditSession.applyEdit in src/services/next-edit/NextEditSession.ts
- [x] T034 [P1] Implement NextEditSession.skipEdit in src/services/next-edit/NextEditSession.ts
- [x] T035 [P1] Implement NextEditSession.getProgress in src/services/next-edit/NextEditSession.ts
- [x] T036 [P1] Implement NextEditSession.complete in src/services/next-edit/NextEditSession.ts

**Checkpoint**: At this point, Requirement Group P1 should be fully functional and testable independently

---

## Phase 4: Requirement Group P2 - Progress Tracking & Bulk Operations (Priority: Should Have)

**Goal**: Add progress visualization, summary views, and bulk edit operations

**Independent Test**: User can see progress bar, view summary, and bulk accept edits

### Tests for Requirement Group P2

- [x] T037 [P] [P2] Unit test for bulk operations in tests/services/next-edit/EditExecutor.spec.ts
- [x] T038 [P] [P2] Unit test for summary generation in tests/services/next-edit/NextEditSession.spec.ts

### Implementation for Requirement Group P2

- [x] T039 [P2] Implement EditExecutor.bulkApplyEdits in src/services/next-edit/EditExecutor.ts
- [x] T040 [P2] Implement NextEditSession.getSummary in src/services/next-edit/NextEditSession.ts
- [x] T041 [P2] Implement NextEditSession.pause in src/services/next-edit/NextEditSession.ts
- [x] T042 [P2] Implement NextEditSession.resume in src/services/next-edit/NextEditSession.ts
- [x] T043 [P2] Implement NextEditSession.cancel in src/services/next-edit/NextEditSession.ts

**Checkpoint**: At this point, Requirement Groups P1 AND P2 should both work independently

---

## Phase 5: Requirement Group P3 - Undo/Redo & Git Integration (Priority: Could Have)

**Goal**: Add undo/redo support and git diff preview

**Independent Test**: User can undo/redo edits and see git diffs before applying

### Tests for Requirement Group P3

- [x] T044 [P] [P3] Unit test for undo/redo in tests/services/next-edit/EditExecutor.spec.ts
- [x] T045 [P] [P3] Unit test for git integration in tests/services/next-edit/EditExecutor.spec.ts

### Implementation for Requirement Group P3

- [x] T046 [P3] Implement EditExecutor.undoLastEdit in src/services/next-edit/EditExecutor.ts
- [x] T047 [P3] Implement EditExecutor.redoLastEdit in src/services/next-edit/EditExecutor.ts
- [x] T048 [P3] Implement EditExecutor.getGitDiff in src/services/next-edit/EditExecutor.ts
- [x] T049 [P3] Implement EditExecutor.previewAllChanges in src/services/next-edit/EditExecutor.ts
- [x] T050 [P3] Implement NextEditSession.undoLastEdit in src/services/next-edit/NextEditSession.ts
- [x] T051 [P3] Implement NextEditSession.redoLastEdit in src/services/next-edit/NextEditSession.ts

**Checkpoint**: All requirement groups should now be independently functional

---

## Phase 6: Extension Integration

**Purpose**: Integrate services with VSCode extension and webview UI

- [x] T052 Create Next Edit tool in src/core/tools/next-edit.ts
- [x] T053 [P] Register Next Edit commands in src/activate/registerCommands.ts with kilocode_change markers
- [x] T054 [P] Add keyboard shortcuts for Next Edit commands in package.json
- [x] T055 Create webview event handlers in src/services/next-edit/webviewHandlers.ts
- [x] T056 Create NextEditPanel React component in webview-ui/src/components/NextEditPanel.tsx
- [x] T057 [P] Add NextEditPanel styles to webview-ui/src/index.css
- [x] T058 Implement webview message passing in webview-ui/src/components/NextEditPanel.tsx
- [x] T059 Create session start dialog component in webview-ui/src/components/NextEditStartDialog.tsx
- [x] T060 [P] Add Next Edit panel to main webview layout in webview-ui/src/App.tsx

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple requirement groups

- [x] T061 [P] Add error handling and user-friendly error messages in src/services/next-edit/
- [x] T062 [P] Add logging for all service operations in src/services/next-edit/
- [x] T063 [P] Add performance optimization (caching, lazy loading) in src/services/next-edit/EditAnalyzer.ts
- [x] T064 [P] Add accessibility features (ARIA labels, keyboard nav) in webview-ui/src/components/NextEditPanel.tsx
- [x] T065 [P] Add comprehensive inline documentation in src/services/next-edit/
- [x] T066 Update README.md with Next Edit feature documentation
- [x] T067 Create feature documentation in apps/kilocode-docs/docs/features/next-edit.md
- [x] T068 Run all tests and ensure 100% pass rate
- [x] T069 Run quickstart.md validation examples
- [x] T070 Create changeset for Next Edit feature release

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all requirement groups
- **Requirement Groups (Phase 3-5)**: All depend on Foundational phase completion
    - P1 (Phase 3) → P2 (Phase 4) → P3 (Phase 5) sequential in priority order
    - Each group should be independently testable before moving to next
- **Extension Integration (Phase 6)**: Depends on all desired requirement groups being complete
- **Polish (Phase 7)**: Depends on Extension Integration completion

### Requirement Group Dependencies

- **Requirement Group P1 (Phase 3)**: Can start after Foundational (Phase 2) - No dependencies on other groups
- **Requirement Group P2 (Phase 4)**: Can start after P1 completion - Extends P1 functionality
- **Requirement Group P3 (Phase 5)**: Can start after P2 completion - Adds advanced features

### Within Each Requirement Group

- Tests MUST be written and FAIL before implementation
- Storage before Analyzer
- Analyzer before Sequencer
- Sequencer before Executor
- Executor before Session
- Session orchestration last
- Group complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational stub tasks marked [P] can run in parallel (within Phase 2)
- All tests for a requirement group marked [P] can run in parallel
- Service implementations within a group can run in parallel if marked [P]
- Extension integration tasks marked [P] can run in parallel
- Polish tasks marked [P] can run in parallel

---

## Parallel Example: Requirement Group P1

```bash
# Launch all tests for Requirement Group P1 together:
Task: "Unit test for SessionStorage in tests/services/next-edit/SessionStorage.spec.ts"
Task: "Unit test for EditAnalyzer in tests/services/next-edit/EditAnalyzer.spec.ts"
Task: "Unit test for EditSequencer in tests/services/next-edit/EditSequencer.spec.ts"
Task: "Unit test for EditExecutor in tests/services/next-edit/EditExecutor.spec.ts"
Task: "Unit test for NextEditSession in tests/services/next-edit/NextEditSession.spec.ts"
Task: "Integration test for session lifecycle in tests/services/next-edit/integration.spec.ts"

# After tests fail, implement storage methods in parallel:
Task: "Implement SessionStorage.saveSession in src/services/next-edit/SessionStorage.ts"
Task: "Implement SessionStorage.loadSession in src/services/next-edit/SessionStorage.ts"
Task: "Implement SessionStorage.deleteSession in src/services/next-edit/SessionStorage.ts"
Task: "Implement SessionStorage.getActiveSessionId in src/services/next-edit/SessionStorage.ts"
```

---

## Implementation Strategy

### MVP First (Requirement Group P1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all groups)
3. Complete Phase 3: Requirement Group P1
4. **STOP and VALIDATE**: Test P1 independently with unit tests
5. Create basic extension integration (minimal commands)
6. Demo core functionality

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add Requirement Group P1 → Test independently → Demo (MVP!)
3. Add Requirement Group P2 → Test independently → Demo
4. Add Requirement Group P3 → Test independently → Demo
5. Add Extension Integration → Full feature ready
6. Polish → Production ready
7. Each group adds value without breaking previous groups

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
    - Developer A: Requirement Group P1 (Core functionality)
    - Developer B: Requirement Group P2 (Progress & bulk)
    - Developer C: Requirement Group P3 (Undo/redo & git)
3. Groups complete and integrate independently
4. Team converges on Extension Integration
5. Team splits Polish tasks

---

## Summary

**Total Tasks**: 70 tasks

- Phase 1 (Setup): 4 tasks
- Phase 2 (Foundational): 8 tasks
- Phase 3 (P1 - Core): 24 tasks (6 tests + 18 implementation)
- Phase 4 (P2 - Progress): 7 tasks (2 tests + 5 implementation)
- Phase 5 (P3 - Advanced): 8 tasks (2 tests + 6 implementation)
- Phase 6 (Integration): 9 tasks
- Phase 7 (Polish): 10 tasks

**Parallel Opportunities**: 35 tasks marked [P] can run in parallel
**Test Coverage**: 10 test files covering all services and integration

**MVP Scope**: Phases 1-3 (36 tasks) - Core session and edit management
**Full Feature**: All 7 phases (70 tasks) - Complete Next Edit feature

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific requirement group (P1, P2, P3) for traceability
- Each requirement group should be independently completable and testable
- Verify tests fail before implementing (TDD approach)
- Commit after each task or logical group
- Stop at any checkpoint to validate group independently
- Avoid: vague tasks, same file conflicts, cross-group dependencies that break independence
- All new files in src/services/next-edit/ are Kilo-specific (no kilocode_change markers needed)
- Modifications to src/activate/registerCommands.ts require kilocode_change markers
