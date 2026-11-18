# Complexity and file-size ratchet

Fix a regression by moving a responsibility, not by changing the measurement. You may lower a ceiling when code shrinks. Do not raise a limit, add an exclusion, or weaken the mapping to pass the check without explicit approval from a human maintainer. Before editing, report the function or file, the measured value, the limit and why an extraction is not possible, then wait for approval. A failing check is not approval for an exception.
