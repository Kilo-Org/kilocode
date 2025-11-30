# update_todo_list

`update_todo_list` 工具用反映当前状态的更新清单替换整个 TODO 列表。它提供分步任务跟踪，允许在更新和在复杂任务期间发现新待办事项时动态添加新待办事项之前确认完成。

## 参数

该工具接受以下参数：

- `todos`（必需）：带有任务描述和状态指示器的 markdown 清单

## 作用

此工具管理一个全面的 TODO 列表，该列表通过不同的状态跟踪任务进度。它在每次更新时替换整个列表，确保当前状态准确反映所有待处理、进行中和已完成的任务。系统将 TODO 列表显示为后续消息中的提醒。

## 何时使用？

- 当任务涉及需要系统跟踪的多个步骤时
- 当新 actionable items are discovered during task execution
- 当更新多个待办事项的状态时
- 当复杂项目受益于清晰、分步的进度跟踪时
- 当组织多阶段工作流 with dependencies

## 主要功能

- 维护具有三种状态的单级 markdown 清单
- 在单个操作中更新多个任务状态
- 动态添加新待办事项 as they're discovered during execution
- 通过状态指示器提供视觉进度跟踪
- 与提醒系统集成 for persistent task visibility
- 支持任务 reordering based on execution priority
- Preserves all unfinished tasks unless explicitly removed
- Enables efficient batch status updates

## 限制

- Limited to single-level checklists (no nesting or subtasks)
- Cannot remove tasks unless they're completed or no longer relevant
- Requires complete list replacement rather than incremental updates
- Status changes must be explicitly managed through tool calls
- No built-in task dependency tracking
- Cannot schedule tasks for future execution
- Limited to three status states (pending, in-progress, completed)

## 状态指示器

该工具使用三种不同的状态指示器：

- `[ ]` **待处理**：任务尚未开始
- `[-]` **进行中**：任务当前正在进行中
- `[x]` **已完成**：任务已完全完成，没有未解决的问题

## 工作原理

当调用 `update_todo_list` 工具时，它遵循以下过程：

1.  **状态验证**：

    - 解析 markdown 清单格式
    - 验证状态指示器格式是否正确
    - 确保任务描述清晰且可操作

2.  **列表替换**：

    - 完全替换现有 TODO 列表
    - Preserves task order as specified in the update
    - Maintains task descriptions and status states

3.  **提醒集成**：

    - 将更新的列表与提醒系统集成
    - Displays current tasks in subsequent message headers
    - Provides persistent visibility of task progress

4.  **进度跟踪**：
    - 跟踪多个更新的完成状态
    - Maintains task history for reference
    - Supports workflow continuation across sessions

## 最佳实践

### 任务管理指南

- Mark tasks as completed immediately after all work is finished
- Start the next task by marking it as in-progress
- Add new todos as soon as they are identified during execution
- Use clear, descriptive task names that indicate specific actions
- Order tasks by logical execution sequence or priority

### 状态更新模式

- Update multiple statuses simultaneously when transitioning between tasks
- Confirm task completion before marking as finished
- Keep in-progress tasks focused on current work
- Add blocking tasks when dependencies are discovered

### 何时使用

Use this tool when:

- The task involves multiple steps or requires ongoing tracking
- New actionable items are discovered during task execution
- Multiple todos need status updates simultaneously
- Complex tasks benefit from clear progress visualization

Avoid using when:

- There is only a single, trivial task
- The task can be completed in one or two simple steps
- The request is purely conversational or informational

## Examples When Used

- When implementing a multi-component feature requiring frontend, backend, and database changes
- When debugging issues that reveal multiple related problems requiring fixes
- When setting up development environments with multiple configuration steps
- When documenting systems that require research, writing, and review phases
- When refactoring code that affects multiple files and requires testing

## 用法示例

Initial task breakdown:

```
<update_todo_list>
<todos>
[-] Analyze requirements and create technical specification
[ ] Design database schema and API endpoints
[ ] Implement backend authentication service
[ ] Create frontend login components
[ ] Write comprehensive tests
[ ] Update documentation
</todos>
</update_todo_list>
```

Updating progress and adding discovered tasks:

```
<update_todo_list>
<todos>
[x] Analyze requirements and create technical specification
[x] Design database schema and API endpoints
[-] Implement backend authentication service
[ ] Create frontend login components
[ ] Write comprehensive tests
[ ] Update documentation
[ ] Add password reset functionality
[ ] Implement rate limiting for login attempts
</todos>
</update_todo_list>
```

Completing multiple tasks and transitioning focus:

```
<update_todo_list>
<todos>
[x] Analyze requirements and create technical specification
[x] Design database schema and API endpoints
[x] Implement backend authentication service
[x] Create frontend login components
[-] Write comprehensive tests
[ ] Update documentation
[ ] Add password reset functionality
[ ] Implement rate limiting for login attempts
</todos>
</update_todo_list>
```
