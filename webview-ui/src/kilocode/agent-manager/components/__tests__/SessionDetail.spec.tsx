import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { Provider, createStore } from "jotai"
import { SessionDetail } from "../SessionDetail"
import {
	sessionsMapAtom,
	sessionOrderAtom,
	selectedSessionIdAtom,
	pendingSessionAtom,
	type AgentSession,
} from "../../state/atoms/sessions"
import { sessionMachineUiStateAtom } from "../../state/atoms/stateMachine"
import type { SessionUiState } from "../../state/sessionStateMachine"

// Mock react-i18next
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, params?: Record<string, unknown>) => {
			if (params) {
				return `${key} ${JSON.stringify(params)}`
			}
			return key
		},
	}),
}))

// Mock vscode postMessage
vi.mock("../../utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock TooltipProvider for StandardTooltip
vi.mock("../../../../components/ui", () => ({
	StandardTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Mock MessageList to simplify tests
vi.mock("../MessageList", () => ({
	MessageList: ({ sessionId }: { sessionId: string }) => <div data-testid="message-list">{sessionId}</div>,
}))

// Mock ChatInput to capture props
const mockChatInputProps = vi.fn()
vi.mock("../ChatInput", () => ({
	ChatInput: (props: {
		sessionId: string
		sessionLabel?: string
		isActive?: boolean
		autoMode?: boolean
		showFinishToBranch?: boolean
		worktreeBranchName?: string
	}) => {
		mockChatInputProps(props)
		return (
			<div data-testid="chat-input">
				{props.showFinishToBranch && <span data-testid="finish-to-branch-enabled">finish enabled</span>}
			</div>
		)
	},
}))

describe("SessionDetail", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	const createSession = (overrides: Partial<AgentSession> = {}): AgentSession => ({
		sessionId: "test-session-123",
		label: "Test Session",
		prompt: "Test prompt",
		status: "running",
		startTime: Date.now(),
		source: "local",
		autoMode: false,
		...overrides,
	})

	const createUiState = (overrides: Partial<SessionUiState> = {}): SessionUiState => ({
		showSpinner: false,
		showCancelButton: false,
		isActive: false,
		...overrides,
	})

	const renderWithStore = (session: AgentSession | null, machineState?: Record<string, SessionUiState>) => {
		const store = createStore()

		if (session) {
			store.set(sessionsMapAtom, { [session.sessionId]: session })
			store.set(sessionOrderAtom, [session.sessionId])
			store.set(selectedSessionIdAtom, session.sessionId)
		} else {
			store.set(sessionsMapAtom, {})
			store.set(sessionOrderAtom, [])
			store.set(selectedSessionIdAtom, null)
		}

		store.set(pendingSessionAtom, null)

		if (machineState) {
			store.set(sessionMachineUiStateAtom, machineState)
		}

		return render(
			<Provider store={store}>
				<SessionDetail />
			</Provider>,
		)
	}

	describe("canFinishWorktree logic", () => {
		describe("showFinishToBranch should be TRUE when", () => {
			it("session has parallelMode.enabled=true AND status=running AND not showing spinner", () => {
				const session = createSession({
					status: "running",
					parallelMode: { enabled: true, branch: "feature/test" },
				})

				renderWithStore(session, {
					[session.sessionId]: createUiState({ isActive: true, showSpinner: false }),
				})

				expect(mockChatInputProps).toHaveBeenCalledWith(
					expect.objectContaining({
						showFinishToBranch: true,
						worktreeBranchName: "feature/test",
					}),
				)
			})

			it("session has parallelMode.enabled=true AND status=running AND spinner showing (waiting states)", () => {
				// When spinner is showing but session is running, we still allow finish
				// because the user might want to finish during a pause
				const session = createSession({
					status: "running",
					parallelMode: { enabled: true, branch: "feature/test" },
				})

				renderWithStore(session, {
					[session.sessionId]: createUiState({ isActive: true, showSpinner: true }),
				})

				// Based on simplified logic: isWorktree && isSessionRunning
				// User can finish a worktree session at any time while it's running
				expect(mockChatInputProps).toHaveBeenCalledWith(
					expect.objectContaining({
						showFinishToBranch: true,
					}),
				)
			})

			it("session has parallelMode.enabled=true AND status=running with branch name", () => {
				const session = createSession({
					status: "running",
					parallelMode: { enabled: true, branch: "kilocode/my-feature" },
				})

				renderWithStore(session, {
					[session.sessionId]: createUiState({ isActive: true, showSpinner: false }),
				})

				expect(mockChatInputProps).toHaveBeenCalledWith(
					expect.objectContaining({
						showFinishToBranch: true,
						worktreeBranchName: "kilocode/my-feature",
					}),
				)
			})
		})

		describe("showFinishToBranch should be FALSE when", () => {
			it("session has parallelMode.enabled=false (local mode)", () => {
				const session = createSession({
					status: "running",
					parallelMode: undefined,
				})

				renderWithStore(session, {
					[session.sessionId]: createUiState({ isActive: true, showSpinner: false }),
				})

				expect(mockChatInputProps).toHaveBeenCalledWith(
					expect.objectContaining({
						showFinishToBranch: false,
					}),
				)
			})

			it("session has parallelMode.enabled=false explicitly", () => {
				const session = createSession({
					status: "running",
					parallelMode: { enabled: false },
				})

				renderWithStore(session, {
					[session.sessionId]: createUiState({ isActive: true, showSpinner: false }),
				})

				expect(mockChatInputProps).toHaveBeenCalledWith(
					expect.objectContaining({
						showFinishToBranch: false,
					}),
				)
			})

			it("session status is not running (done)", () => {
				const session = createSession({
					status: "done",
					parallelMode: { enabled: true, branch: "feature/test" },
				})

				renderWithStore(session, {
					[session.sessionId]: createUiState({ isActive: false, showSpinner: false }),
				})

				expect(mockChatInputProps).toHaveBeenCalledWith(
					expect.objectContaining({
						showFinishToBranch: false,
					}),
				)
			})

			it("session status is not running (stopped)", () => {
				const session = createSession({
					status: "stopped",
					parallelMode: { enabled: true, branch: "feature/test" },
				})

				renderWithStore(session, {
					[session.sessionId]: createUiState({ isActive: false, showSpinner: false }),
				})

				expect(mockChatInputProps).toHaveBeenCalledWith(
					expect.objectContaining({
						showFinishToBranch: false,
					}),
				)
			})

			it("session status is not running (error)", () => {
				const session = createSession({
					status: "error",
					parallelMode: { enabled: true, branch: "feature/test" },
				})

				renderWithStore(session, {
					[session.sessionId]: createUiState({ isActive: false, showSpinner: false }),
				})

				expect(mockChatInputProps).toHaveBeenCalledWith(
					expect.objectContaining({
						showFinishToBranch: false,
					}),
				)
			})
		})

		describe("worktreeBranchName prop", () => {
			it("passes branch name when available", () => {
				const session = createSession({
					status: "running",
					parallelMode: { enabled: true, branch: "kilocode/feature-123" },
				})

				renderWithStore(session, {
					[session.sessionId]: createUiState({ isActive: true, showSpinner: false }),
				})

				expect(mockChatInputProps).toHaveBeenCalledWith(
					expect.objectContaining({
						worktreeBranchName: "kilocode/feature-123",
					}),
				)
			})

			it("passes undefined when branch name not available", () => {
				const session = createSession({
					status: "running",
					parallelMode: { enabled: true },
				})

				renderWithStore(session, {
					[session.sessionId]: createUiState({ isActive: true, showSpinner: false }),
				})

				expect(mockChatInputProps).toHaveBeenCalledWith(
					expect.objectContaining({
						worktreeBranchName: undefined,
					}),
				)
			})
		})
	})

	describe("worktree badge display", () => {
		it("shows worktree badge with branch name when parallelMode.enabled", () => {
			const session = createSession({
				status: "running",
				parallelMode: { enabled: true, branch: "feature/test-branch" },
			})

			renderWithStore(session, {
				[session.sessionId]: createUiState({ isActive: true, showSpinner: false }),
			})

			// Check for GitBranch icon and branch name in the header
			expect(screen.getByText("feature/test-branch")).toBeInTheDocument()
		})

		it("shows local badge when parallelMode not enabled", () => {
			const session = createSession({
				status: "running",
				parallelMode: undefined,
			})

			renderWithStore(session, {
				[session.sessionId]: createUiState({ isActive: true, showSpinner: false }),
			})

			// Check for local mode indicator
			expect(screen.getByText("sessionDetail.runModeLocal")).toBeInTheDocument()
		})
	})

	describe("terminal button visibility", () => {
		it("hides terminal button for provisional sessions", () => {
			const session = createSession({
				sessionId: "provisional-123",
				status: "running",
				parallelMode: { enabled: true, branch: "feature/test" },
			})

			renderWithStore(session, {
				[session.sessionId]: createUiState({ isActive: true, showSpinner: false }),
			})

			expect(screen.queryByLabelText("sessionDetail.openTerminal")).not.toBeInTheDocument()
		})

		it("shows terminal button for non-provisional sessions", () => {
			const session = createSession({
				sessionId: "real-session-123",
				status: "running",
				parallelMode: { enabled: true, branch: "feature/test" },
			})

			renderWithStore(session, {
				[session.sessionId]: createUiState({ isActive: true, showSpinner: false }),
			})

			expect(screen.getByLabelText("sessionDetail.openTerminal")).toBeInTheDocument()
		})
	})
})
