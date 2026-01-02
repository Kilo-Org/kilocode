# BMAD Embedded Modules

## Overview

BMAD modules are now embedded directly in the Kilo Code extension, eliminating the need for external installation via `npx bmad-method@alpha install`. This ensures that all BMAD functionality is available out-of-the-box when users install the VSIX package.

## Architecture

### Module Loading Priority

The system follows this priority when loading BMAD modules:

1. **External Installation** (highest priority) - If user has BMAD installed externally, it takes precedence
2. **Embedded Modules** - Fallback to embedded modules when external installation is not available
3. **Custom Modules** - User-defined custom modules

### Embedded Module Structure

```
src/assets/bmad/
├── bmm/                    # BMAD Method Manager
│   ├── config.yaml
│   ├── agents/
│   │   ├── bmad-bmm-master.yaml
│   │   ├── bmad-bmm-analyst.yaml
│   │   ├── bmad-bmm-architect.yaml
│   │   ├── bmad-bmm-dev.yaml
│   │   ├── bmad-bmm-pm.yaml
│   │   ├── bmad-bmm-sm.yaml
│   │   ├── bmad-bmm-tea.yaml
│   │   ├── bmad-bmm-tech-writer.yaml
│   │   ├── bmad-bmm-ux-designer.yaml
│   │   └── bmad-bmm-quick-flow-solo-dev.yaml
│   ├── workflows/
│   │   └── bmad-quick-flow.yaml
│   └── templates/
│       └── quick-flow-template.md
├── bmb/                    # BMAD Brain
│   └── config.yaml
├── cis/                    # Code Intelligence System
│   └── config.yaml
└── bmgb/                   # BMAD Global Brain
    └── config.yaml
```

## Available Modes

The following BMAD modes are automatically available:

- **🤖 Bmad Master** - Orchestrates all BMAD workflows and coordinates between specialized agents
- **🤖 Analyst** - Business and technical analysis agent
- **🤖 Architect** - System architecture and design agent
- **🤖 Dev** - Development agent for implementation and bug fixing
- **🤖 Pm** - Project management agent
- **🤖 Sm** - Scrum Master agent for agile processes
- **🤖 Tea** - Testing and QA agent
- **🤖 Tech Writer** - Technical writing agent
- **🤖 Ux Designer** - UX design agent
- **🤖 Quick Flow Solo Dev** - Quick flow agent for rapid development

## Workflows

### BMAD Quick Flow

A rapid development workflow with the following steps:

1. **Analyze Requirements** - Quickly analyze requirements and propose solutions
2. **Implement Feature** - Rapidly implement the feature
3. **Test** - Write and run tests
4. **Document** - Create documentation

## Configuration

### VS Code Settings

```json
{
	"bmad.enabled": true,
	"bmad.installationPath": "_bmad",
	"bmad.activeModules": ["bmm", "bmb", "cis", "bmgd"],
	"bmad.autoSyncModes": true,
	"bmad.syncInterval": 300000,
	"bmad.knowledgeBaseEnabled": true,
	"bmad.partyModeEnabled": true
}
```

### Module Priority

Users can still override embedded modules by installing BMAD externally:

```bash
npx bmad-method@alpha install
```

External installations always take precedence over embedded modules.

## Implementation Details

### Loading Mechanism

The `BmadIntegrationService` class handles module loading:

1. Checks for external BMAD installation
2. Falls back to embedded modules if external not found
3. Loads module configurations, agents, workflows, and templates
4. Syncs agents as Kilo Code modes

### File Access

Embedded modules are accessed using VS Code's file system API:

```typescript
const moduleUri = vscode.Uri.joinPath(context.extensionUri, "assets", "bmad", moduleName)
const content = await vscode.workspace.fs.readFile(configUri)
```

### Packaging

Embedded modules are included in the VSIX package via [`package.json`](../package.json):

```json
{
	"files": ["assets/bmad/**/*"]
}
```

## Benefits

1. **Zero Setup** - Users don't need to install BMAD separately
2. **Independence** - No dependency on external BMAD repository
3. **Reliability** - Embedded modules are always available
4. **Flexibility** - External installations can still override embedded modules
5. **Consistency** - All users get the same BMAD experience

## Testing

Test coverage is provided in [`embedded-modules.spec.ts`](./__tests__/embedded-modules.spec.ts):

- Module loading from embedded assets
- Agent loading and registration
- Workflow loading and execution
- Template loading and rendering
- Priority handling (external vs embedded)
- Error handling and graceful degradation

## Future Enhancements

Potential improvements:

1. Add more workflows for different development scenarios
2. Implement module versioning and updates
3. Add module marketplace for community contributions
4. Implement hot-reloading of embedded modules
5. Add module validation and health checks

## Troubleshooting

### Modules Not Loading

1. Check VS Code settings to ensure BMAD is enabled
2. Verify the extension context is properly initialized
3. Check the developer console for error messages

### External Installation Not Detected

1. Verify the installation path in settings
2. Ensure the installation directory exists
3. Check file permissions

### Mode Sync Issues

1. Verify `bmad.autoSyncModes` is enabled
2. Check the sync interval setting
3. Restart VS Code to force re-sync

## References

- [BMAD Integration Service](./BmadIntegrationService.ts)
- [BMAD Mode Manager](./BmadModeManager.ts)
- [BMAD Types](./types.ts)
- [BMAD Configuration](./config.ts)
