# Required E2E Workflows

Workflow 1:
User request -> Claude contract -> Hermes routing -> ZeroClaw execution -> KiloCode result -> Speech output

Workflow 2:
Primary execution fails -> fallback provider takes over -> task succeeds

Workflow 3:
Task writes memory -> later task recalls it -> recalled info used
