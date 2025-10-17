**Notes for Testing:**

**WARNING**: THIS IS ALPHA QUALITY AT BEST. DO NOT USE THIS FOR ANYTHING YOU CARE ABOUT - IT WILL STEAL YOUR FIRSTBORN CHILD.

**Configuration**

- Create or edit an existing Kilo Code or OpenRouter Provider Profile
    - The majority of testing was done with variants of GPT-5
    - Qwen3-Coder 480B was also tested
    - Sonnet 4.5 was mildly tested.
    - Make sure you use a model that supports native function calls - the majority of models release after Jan 2025 will support them.
- Open the Advanced Panel at the bottom
- Change the Tool Call Style to "JSON"
- Save your configuration
- Go forth and code with faster and more reliable tool calls!

**Tidbits**:

- The cache hit rates are kinda crazy (often 90%):

```json

  "tokens_prompt": 9361,
  "tokens_completion": 43,
  "native_tokens_prompt": 9191,
  "native_tokens_completion": 56,
  "native_tokens_completion_images": null,
  "native_tokens_reasoning": 0,
  "native_tokens_cached": 8576
```

- I've also confirmed that XML tool calls also still work when the profile is set to that mode.

**Caveats and Limits**

- Currently, **ONLY** OpenRouter and Kilo Code providers work with native tool calling.

    - While the selector box for tool calling style appears on every provider page for now, it only will actually work in JSON mode on Kilo Code and OpenRouter. This will be easy to expand as testing is performed

- I've tested all of the 18 primary tools:
    - `ask_followup_question`, `attempt_completion`, `browser_action`, `codebase_search`, `apply_diff` (edit_file), `execute_command`, `fetch_instructions`, `insert_content`, `list_code_definition_names` (TIL this one even exists),`list_files`, `new_task`, `read_file`, `run_slash_command`, `search_and_replace`, `search_files`, `switch_mode`, `update_todo_list`,`use_mcp_tool`, `write_to_file`
- MCP Servers DO work a little, but are a little inconsistent and finicky. I think I know how to fix this.
