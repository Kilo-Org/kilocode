# Auto-Queue Feature Test Plan

## Test Scenario

1. Enable auto-queue with a simple message
2. Start a task that will complete quickly
3. Verify that the queued message is submitted as a continuation of the conversation

## Test Steps

### Step 1: Enable Auto-Queue

- Open the extension
- Type a message in the queue input: "Please create a simple hello.txt file with 'Hello World' content"
- Click "Enable Auto-Queue"

### Step 2: Start Initial Task

- Type in main chat: "Create a test.txt file with the content 'This is a test'"
- Send the message
- Wait for task to complete and show completion buttons

### Step 3: Verify Auto-Queue Behavior

- The auto-queue should detect the completion_result ask state
- It should automatically click "Resume Task" with the queued message
- The conversation should continue with the queued message
- A hello.txt file should be created

## Expected Results

- No new task should be created
- The conversation should flow naturally as if the user typed the queued message after clicking "Resume Task"
- Both test.txt and hello.txt files should exist
- The auto-queue should be disabled after execution

## Debug Information to Monitor

- Check console logs for auto-queue DEBUG messages
- Verify task stack behavior
- Confirm message flow through handleWebviewAskResponse
