# Default Model

A user should be able to indicate the model they want to use. To this end a user can
indicate what the default model should be.

But sometimes the user either

- changed their opinion, and wants to use a new default model
- wants to use a different model for a specific session

These two usecases look very similar for a user using only one agent at the time. They change their default model, start the next session, and then change the model again perhaps.

But for using using many concurrent agents, it is important to be able to change the model for a specific session without changing the default model, as they would still expect starting a new session will be predictable and not affected by some other unrelated session.

## Settings

The Settings tab has a "Default model" picker. Whatever model is selected there is used as the starting model for every new session.

## New Session

When a new session is created, the model selector is pre-populated with the default model from Settings.

## Model Selector in Chat Input

Changing the model in the chat input changes it only for the current session. It has no effect on future sessions. The default in Settings remains unchanged.

Maybe we do need a shortcut after the changing of the model to make it the default more easily? Like a "Make default" button?
