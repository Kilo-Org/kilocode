# Skills Command

The `/skill` command enables installing, listing, and managing skills from the [skills.sh](https://skills.sh) ecosystem directly within the Kilo Code CLI.

## What are Skills?

Skills are reusable capabilities for AI agents that provide procedural knowledge. They help agents accomplish specific tasks more effectively by packaging instructions, scripts, and resources that agents can discover and use automatically.

Learn more at [agentskills.io](https://agentskills.io) and browse available skills at [skills.sh](https://skills.sh).

## Usage

### Install Skills

Install skills from a GitHub repository:

```bash
# Basic install (project scope)
/skill add vercel-labs/agent-skills

# Install to global scope
/skill add vercel-labs/agent-skills --global

# Force overwrite existing skills
/skill add vercel-labs/agent-skills --force

# Full GitHub URL also works
/skill add https://github.com/vercel-labs/agent-skills
```

### List Installed Skills

```bash
# List all installed skills (project + global)
/skill list

# List only project skills
/skill list --project

# List only global skills
/skill list --global
```

### Remove Skills

```bash
# Remove a skill (searches both scopes)
/skill remove vercel-react-best-practices

# Remove from specific scope
/skill remove vercel-react-best-practices --project
/skill remove vercel-react-best-practices --global
```

## Skill Locations

Skills are stored in the following directories:

| Scope   | Location                       |
| ------- | ------------------------------ |
| Project | `.kilocode/skills/`            |
| Global  | `~/.kilocode/skills/`          |

Project skills are specific to your current workspace and can be committed to version control. Global skills are available across all projects.

## Skill Format

Skills are directories containing a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: My Custom Skill
description: A helpful skill for doing something specific
---

# My Custom Skill

Instructions and content for the agent...
```

### Required Fields

- `name`: The skill's display name
- `description`: Brief explanation of what the skill does

## Popular Skills

Here are some popular skills from the [skills.sh leaderboard](https://skills.sh):

| Skill | Description |
| ----- | ----------- |
| [vercel-react-best-practices](https://skills.sh/vercel-labs/agent-skills/vercel-react-best-practices) | React and Next.js performance optimization guidelines |
| [web-design-guidelines](https://skills.sh/vercel-labs/agent-skills/web-design-guidelines) | Review UI code for web interface best practices |
| [vercel-composition-patterns](https://skills.sh/vercel-labs/agent-skills/vercel-composition-patterns) | React composition patterns that scale |

Install them with:

```bash
/skill add vercel-labs/agent-skills
```

## Creating Your Own Skills

1. Create a directory for your skill
2. Add a `SKILL.md` file with the required frontmatter
3. Place it in `.kilocode/skills/` (project) or `~/.kilocode/skills/` (global)

Example:

```bash
mkdir -p .kilocode/skills/my-custom-skill
cat > .kilocode/skills/my-custom-skill/SKILL.md << 'EOF'
---
name: My Custom Skill
description: Custom instructions for my project
---

# My Custom Skill

When working on this project, always:
- Use TypeScript strict mode
- Follow our naming conventions
- Run tests before committing
EOF
```

## Compatibility

Kilo Code's skill format is compatible with the [Agent Skills](https://agentskills.io) open standard, used by:

- Claude Code
- Cursor
- Codex
- And many other AI agents

Skills installed via `/skill add` will work across all compatible agents.

## Troubleshooting

### "No skills found in repository"

The repository must contain at least one `SKILL.md` file with valid YAML frontmatter including `name` and `description` fields.

### "Already installed"

Use `--force` to overwrite existing skills:

```bash
/skill add owner/repo --force
```

### Permission errors

If you can't write to the global skills directory, use project scope:

```bash
/skill add owner/repo --project
```
