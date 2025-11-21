import { t } from "i18next"
import { ArrowRight, Check, ListChecks, SquareDashed } from "lucide-react"

type TodoStatus = "completed" | "in_progress" | "pending"

interface TodoItem {
	id?: string
	content: string
	status?: TodoStatus | string
}

interface TodoChangeDisplayProps {
	previousTodos: TodoItem[]
	newTodos: TodoItem[]
}

interface TodoGroup {
	todos: TodoItem[]
	status: TodoStatus | null
	keyPrefix: string
	className?: string
}

function getTodoIcon(status: TodoStatus | null) {
	switch (status) {
		case "completed":
			return <Check className="size-3 mt-1 shrink-0" />
		case "in_progress":
			return <ArrowRight className="size-3 mt-1 shrink-0" />
		default:
			return <SquareDashed className="size-3 mt-1 shrink-0" />
	}
}

function TodoList({ todos, status, keyPrefix, className }: TodoGroup) {
	if (todos.length === 0) return null

	return (
		<ul className="list-none space-y-1 my-1">
			{todos.map((todo) => {
				const icon = getTodoIcon(status)
				return (
					<li
						key={`${keyPrefix}-${todo.id || todo.content}`}
						className={`flex flex-row gap-2 items-start ${className || ""}`}>
						{icon}
						<span>{todo.content}</span>
					</li>
				)
			})}
		</ul>
	)
}

export function TodoChangeDisplay({ previousTodos, newTodos }: TodoChangeDisplayProps) {
	const isInitialState = previousTodos.length === 0

	// Determine which todos to display
	let todoGroups: TodoGroup[]

	if (isInitialState && newTodos.length > 0) {
		// For initial state, show all todos grouped by status
		todoGroups = [
			{
				todos: newTodos.filter((todo) => !todo.status || todo.status === "pending"),
				status: null,
				keyPrefix: "pending",
			},
			{
				todos: newTodos.filter((todo) => todo.status === "in_progress"),
				status: "in_progress",
				keyPrefix: "in-progress",
				className: "text-vscode-charts-yellow",
			},
			{
				todos: newTodos.filter((todo) => todo.status === "completed"),
				status: "completed",
				keyPrefix: "completed",
			},
		]
	} else {
		// For updates, only show changes
		const completedTodos = newTodos.filter((newTodo) => {
			if (newTodo.status !== "completed") return false
			const previousTodo = previousTodos.find((p) => p.id === newTodo.id || p.content === newTodo.content)
			return !previousTodo || previousTodo.status !== "completed"
		})

		const startedTodos = newTodos.filter((newTodo) => {
			if (newTodo.status !== "in_progress") return false
			const previousTodo = previousTodos.find((p) => p.id === newTodo.id || p.content === newTodo.content)
			return !previousTodo || previousTodo.status !== "in_progress"
		})

		todoGroups = [
			{
				todos: completedTodos,
				status: "completed",
				keyPrefix: "completed",
			},
			{
				todos: startedTodos,
				status: "in_progress",
				keyPrefix: "started",
				className: "text-vscode-charts-yellow",
			},
		]
	}

	// If no todos to display, don't render anything
	if (todoGroups.every((group) => group.todos.length === 0)) {
		return null
	}

	return (
		<div data-todo-changes className="overflow-hidden">
			<div className="flex items-center gap-2">
				<ListChecks className="size-4 shrink-0" />
				<span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-base font-semibold">
					{t("chat:todo.updated")}
				</span>
			</div>

			<div className="pl-1 pr-1 pt-1 font-light leading-normal">
				{todoGroups.map((group, index) => (
					<TodoList key={index} {...group} />
				))}
			</div>
		</div>
	)
}
