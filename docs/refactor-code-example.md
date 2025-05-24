# Refactor Code Tool - Working Example

## Batch Rename with old_name

The refactor code tool now supports batch renaming using symbol names instead of line numbers, making it more robust against file changes.

### Example: Renaming multiple functions

Given a file with these functions:

```javascript
function cn() {
	/* ... */
}
function testItOne() {
	/* ... */
}
function doSomething() {
	/* ... */
}
function demoWowItIsWorking() {
	/* ... */
}
```

You can rename them all in one batch operation:

```xml
<refactor_code>
<path>src/utils/demo.js</path>
<operations>
[
  {
    "operation": "rename_symbol",
    "old_name": "cn",
    "new_name": "cnDemo"
  },
  {
    "operation": "rename_symbol",
    "old_name": "testItOne",
    "new_name": "testDemoFunction"
  },
  {
    "operation": "rename_symbol",
    "old_name": "doSomething",
    "new_name": "performDemoAction"
  },
  {
    "operation": "rename_symbol",
    "old_name": "demoWowItIsWorking",
    "new_name": "demoShowcaseFeature"
  }
]
</operations>
</refactor_code>
```

### Benefits over line-based renaming:

1. **Survives file edits** - If lines are added/removed, the rename still works
2. **More readable** - Clear what's being renamed without looking at line numbers
3. **Batch friendly** - Can rename many symbols without worrying about line shifts

### When to use line numbers:

- When you have multiple symbols with the same name
- When you need to rename a specific occurrence
- When combined with old_name for extra precision
