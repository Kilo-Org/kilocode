import React from "react"

export const MentionChipDemo: React.FC = () => {
	return (
		<div style={{ padding: "20px", fontFamily: "monospace" }}>
			<h3>Mention Chip Icons Demo</h3>
			<p>Here are some examples of mention chips with file format icons:</p>

			<div style={{ margin: "20px 0" }}>
				<h4>File Mentions (with icons):</h4>
				<span className="mention-chip" data-mention-value="@App.tsx" aria-label="App.tsx">
					<img
						src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIiIGhlaWdodD0iMTIiIHZpZXdCb3g9IjAgMCAxMiAxMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjEyIiBoZWlnaHQ9IjEyIiByeD0iMiIgZmlsbD0iIzAwNjZGRiIvPgo8cGF0aCBkPSJNMyA5VjMuNUw2IDZINUwyIDhIM1oiIGZpbGw9IndoaXRlIi8+CjxwYXRoIGQ9Ik04IDhWN0w5IDZIN0w4IDh6IiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K"
						className="mention-chip__icon"
						alt=""
					/>
					<span className="mention-chip__at">@</span>
					<span className="mention-chip__primary">App.tsx</span>
				</span>{" "}
				<span className="mention-chip" data-mention-value="@script.js" aria-label="script.js">
					<img
						src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIiIGhlaWdodD0iMTIiIHZpZXdCb3g9IjAgMCAxMiAxMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjEyIiBoZWlnaHQ9IjEyIiByeD0iMiIgZmlsbD0iI0Y1QjkzMSIvPgo8cGF0aCBkPSJNMyA5VjMuNUw2IDZINUwyIDhIM1oiIGZpbGw9IndoaXRlIi8+CjxwYXRoIGQ9Ik04IDhWN0w5IDZIN0w4IDh6IiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K"
						className="mention-chip__icon"
						alt=""
					/>
					<span className="mention-chip__at">@</span>
					<span className="mention-chip__primary">script.js</span>
				</span>{" "}
				<span className="mention-chip" data-mention-value="@styles.css" aria-label="styles.css">
					<img
						src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIiIGhlaWdodD0iMTIiIHZpZXdCb3g9IjAgMCAxMiAxMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjEyIiBoZWlnaHQ9IjEyIiByeD0iMiIgZmlsbD0iIzMzODFFMSIvPgo8cGF0aCBkPSJNMyA5VjMuNUw2IDZINUwyIDhIM1oiIGZpbGw9IndoaXRlIi8+CjxwYXRoIGQ9Ik04IDhWN0w5IDZIN0w4IDh6IiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4K"
						className="mention-chip__icon"
						alt=""
					/>
					<span className="mention-chip__at">@</span>
					<span className="mention-chip__primary">styles.css</span>
				</span>
			</div>

			<div style={{ margin: "20px 0" }}>
				<h4>Non-file Mentions (no icons):</h4>
				<span className="mention-chip" data-mention-value="@problems" aria-label="problems">
					<span className="mention-chip__at">@</span>
					<span className="mention-chip__primary">problems</span>
				</span>{" "}
				<span className="mention-chip" data-mention-value="@terminal" aria-label="terminal">
					<span className="mention-chip__at">@</span>
					<span className="mention-chip__primary">terminal</span>
				</span>
			</div>
		</div>
	)
}
