---
name: chart
description: Use when the user asks to visualize data with charts, graphs, or plots using the `chart` tool (bar, line, scatter, pie, time series, etc.).
---

# Data Visualization

The `chart` tool is ALWAYS available in this environment. When the user asks to visualize data (charts, graphs, plots), you MUST call the `chart` tool. Never output the config as text, never say the tool is unavailable, never suggest external renderers. Always use the tool call — it is the only correct response for data visualization requests. Do NOT repeat or echo the config JSON in your text response.

Use the `chart` tool when:
- The user asks for a chart, graph, or plot of data (bar, line, scatter, pie, time series, etc.)
- Presenting numerical data that would be clearer visually than as a table or prose (trends, comparisons, distributions)

Use mermaid fenced code blocks (` ```mermaid `) when:
- The user asks for a diagram, flowchart, sequence diagram, ER diagram, or architecture diagram
- Visualizing relationships, processes, or structure — not data values

Mermaid is NOT a tool and is NOT Chart.js — never call the `chart` tool for mermaid diagrams. Just write the mermaid syntax directly in your text response inside a fenced code block. No tool call needed.

Do not use either for: code, text, or data that is already clear in prose or table form.

The `chart` tool input accepts:
- `title` (string) — short label shown in the tool header
- `description` (string, optional) — subtitle shown below the title
- `spec` (string) — a Chart.js config object as a JSON string

The `spec` field must be a Chart.js config JSON string with `type`, `data`, and optionally `options`. Examples:

Bar chart:
```json
{
  "type": "bar",
  "data": {
    "labels": ["A", "B", "C"],
    "datasets": [{ "label": "Value", "data": [10, 20, 15] }]
  }
}
```

Line chart:
```json
{
  "type": "line",
  "data": {
    "labels": ["Jan", "Feb", "Mar", "Apr"],
    "datasets": [{ "label": "Value", "data": [10, 28, 19, 45], "fill": false }]
  }
}
```

Scatter plot:
```json
{
  "type": "scatter",
  "data": {
    "datasets": [{
      "label": "Points",
      "data": [{ "x": 1, "y": 5 }, { "x": 2, "y": 8 }, { "x": 3, "y": 3 }]
    }]
  }
}
```

Time series:
```json
{
  "type": "line",
  "data": {
    "labels": ["2024-01", "2024-02", "2024-03", "2024-04"],
    "datasets": [{ "label": "Value", "data": [120, 145, 132, 178], "fill": true }]
  }
}
```

Pie chart:
```json
{
  "type": "pie",
  "data": {
    "labels": ["A", "B", "C"],
    "datasets": [{ "data": [30, 50, 20] }]
  }
}
```

You may customize colors by setting `backgroundColor` and `borderColor` arrays on datasets. The renderer handles sizing — do not set width or height.
