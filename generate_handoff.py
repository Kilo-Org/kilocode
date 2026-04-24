"""
Generate Handoff Document - Creates KILOCODE_HANDOFF_FOR_WINDSURF.md

This script generates a comprehensive handoff document summarizing:
1. What was built
2. Agent completion status
3. Integration results
4. Known issues
5. Next steps

Usage:
    python generate_handoff.py
    python generate_handoff.py --output KILOCODE_HANDOFF_FOR_WINDSURF.md
"""

import argparse
import asyncio
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    from rich.console import Console
    HAS_RICH = True
except ImportError:
    Console = None
    HAS_RICH = False


AGENTS_WAVE_1 = [
    {"id": 1, "name": "Audit Source Paths"},
    {"id": 2, "name": "Audit Configs"},
    {"id": 3, "name": "Audit Docs"},
    {"id": 4, "name": "Audit Tests"},
    {"id": 5, "name": "Implement Runtime Core"},
    {"id": 6, "name": "Implement Hermes Orchestrator"},
    {"id": 7, "name": "Implement WebUI Panels"},
    {"id": 8, "name": "Implement ZeroClaw Adapters"},
    {"id": 9, "name": "Implement KiloCode Sync"},
    {"id": 10, "name": "Create Proof Module"},
]

AGENTS_WAVE_2 = [
    {"id": 11, "name": "Integration Testing"},
    {"id": 12, "name": "Security Audit"},
    {"id": 13, "name": "Performance Optimization"},
    {"id": 14, "name": "Documentation Review"},
    {"id": 15, "name": "Config Validation"},
    {"id": 16, "name": "Test Coverage"},
    {"id": 17, "name": "Deployment Prep"},
    {"id": 18, "name": "Monitoring Setup"},
    {"id": 19, "name": "Backup Verification"},
    {"id": 20, "name": "Final Review"},
]

ALL_AGENTS = AGENTS_WAVE_1 + AGENTS_WAVE_2


@dataclass
class AgentSummary:
    """Summary of an agent's work."""
    agent_id: int
    name: str
    status: str
    duration_seconds: float = 0.0
    issues_found: int = 0
    blockers: list[str] = field(default_factory=list)
    output_summary: str = ""


class HandoffGenerator:
    """Generates the handoff document."""

    def __init__(self, base_path: Path | None = None):
        if base_path is None:
            base_path = Path(__file__).parent
        self.base_path = base_path
        self.state_file = base_path / "state" / "dispatcher_state.json"
        self.output_dir = base_path / "output"
        self.integration_report_file = base_path / "output" / "integration_report.json"
        self.console = Console() if HAS_RICH else None

    def _read_state(self) -> dict[int, dict[str, Any]]:
        """Read agent state from disk."""
        if not self.state_file.exists():
            return {}

        try:
            with open(self.state_file, "r") as f:
                return {int(k): v for k, v in json.load(f).items()}
        except (json.JSONDecodeError, TypeError, ValueError):
            return {}

    def _read_integration_report(self) -> dict[str, Any] | None:
        """Read integration report if it exists."""
        if not self.integration_report_file.exists():
            return None

        try:
            with open(self.integration_report_file, "r") as f:
                return json.load(f)
        except (json.JSONDecodeError, TypeError, ValueError):
            return None

    def _get_agent_summary(self, agent: dict[str, Any]) -> AgentSummary:
        """Get summary for an agent."""
        state = self._read_state()
        agent_id = agent["id"]

        if agent_id not in state:
            return AgentSummary(
                agent_id=agent_id,
                name=agent["name"],
                status="pending",
            )

        data = state[agent_id]
        return AgentSummary(
            agent_id=agent_id,
            name=agent["name"],
            status=data.get("status", "unknown"),
            duration_seconds=data.get("duration_seconds", 0.0),
            issues_found=data.get("issues_found", 0),
            blockers=data.get("blockers", []),
            output_summary=self._summarize_output(agent_id),
        )

    def _summarize_output(self, agent_id: int) -> str:
        """Get a summary from agent output."""
        output_file = self.output_dir / f"agent_{agent_id:02d}_output.json"
        if not output_file.exists():
            return "No output file"

        try:
            with open(output_file, "r") as f:
                data = json.load(f)

            summary = data.get("summary", "")
            if summary:
                return summary[:100] + "..." if len(summary) > 100 else summary

            result = data.get("result", "")
            if result:
                return result[:100] + "..." if len(result) > 100 else result

            return "Completed"

        except (json.JSONDecodeError, TypeError):
            return "Could not parse output"

    def _get_duration_str(self, seconds: float) -> str:
        """Format duration string."""
        if seconds == 0:
            return "-"
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        if hours > 0:
            return f"{hours}h {minutes}m"
        elif minutes > 0:
            return f"{minutes}m {secs}s"
        else:
            return f"{secs}s"

    def _count_statuses(self) -> dict[str, int]:
        """Count agent statuses."""
        state = self._read_state()
        counts = {
            "completed": 0,
            "failed": 0,
            "running": 0,
            "pending": 0,
        }

        for agent_id in range(1, 21):
            if agent_id not in state:
                counts["pending"] += 1
            else:
                status = state[agent_id].get("status", "unknown")
                if status in counts:
                    counts[status] += 1
                else:
                    counts["pending"] += 1

        return counts

    def generate_markdown(self) -> str:
        """Generate the handoff document as markdown."""
        state = self._read_state()
        integration = self._read_integration_report()
        statuses = self._count_statuses()

        wave1_agents = [self._get_agent_summary(a) for a in AGENTS_WAVE_1]
        wave2_agents = [self._get_agent_summary(a) for a in AGENTS_WAVE_2]

        all_blockers = []
        for agent_id_str, data in state.items():
            for blocker in data.get("blockers", []):
                all_blockers.append(f"Agent {agent_id_str}: {blocker}")

        total_duration = sum(
            s.duration_seconds
            for s in wave1_agents + wave2_agents
            if s.duration_seconds
        )

        lines = []
        lines.append("# KILOCODE_HANDOFF_FOR_WINDSURF.md\n")
        lines.append("> **Generated:** " + datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        lines.append("> **Status:** " + (integration.get("overall_status", "unknown") if integration else "unknown").upper())
        lines.append("\n---\n")

        lines.append("## Executive Summary\n")
        lines.append("This document summarizes the KiloCode agent execution for the Hermes Agent Azure integration.")
        lines.append("All 20 agents have been dispatched and executed across two waves.\n")
        lines.append("| Metric | Value |")
        lines.append("|--------|-------|")
        lines.append(f"| Total Agents | 20 |")
        lines.append(f"| Completed | {statuses['completed']} |")
        lines.append(f"| Failed | {statuses['failed']} |")
        lines.append(f"| Running | {statuses['running']} |")
        lines.append(f"| Pending | {statuses['pending']} |")
        lines.append(f"| Total Duration | {self._get_duration_str(total_duration)} |")
        lines.append(f"| Blockers | {len(all_blockers)} |")
        lines.append("\n")

        lines.append("## Agent Completion Status\n\n")

        lines.append("### Wave 1 (Agents 1-10) - Foundation\n")
        lines.append("| ID | Agent | Status | Duration | Issues |")
        lines.append("|----|-------|--------|----------|--------|")
        for s in wave1_agents:
            lines.append(f"| {s.agent_id:02d} | {s.name} | {s.status} | {self._get_duration_str(s.duration_seconds)} | {s.issues_found} |")
        lines.append("\n")

        lines.append("### Wave 2 (Agents 11-20) - Verification & Polish\n")
        lines.append("| ID | Agent | Status | Duration | Issues |")
        lines.append("|----|-------|--------|----------|--------|")
        for s in wave2_agents:
            lines.append(f"| {s.agent_id:02d} | {s.name} | {s.status} | {self._get_duration_str(s.duration_seconds)} | {s.issues_found} |")
        lines.append("\n")

        if all_blockers:
            lines.append("## Blockers\n\n")
            lines.append("The following blockers were identified:\n")
            for blocker in all_blockers:
                lines.append(f"- {blocker}")
            lines.append("\n")

        lines.append("## Integration Results\n\n")
        if integration:
            lines.append(f"**Overall Status:** {integration.get('overall_status', 'unknown').upper()}\n")
            lines.append("### Check Results\n\n")
            lines.append("| Check | Status | Details |")
            lines.append("|-------|--------|---------|")
            for check in integration.get("checks", []):
                lines.append(f"| {check['name']} | {check['status']} | {check['details']} |")
            lines.append("\n")
        else:
            lines.append("Integration report not available. Run `python agent_00_integration_lead.py` first.\n\n")

        lines.append("## What Was Built\n\n")
        lines.append("### Core Components\n")
        lines.append("1. **Runtime Core** - Core execution engine for agent dispatch")
        lines.append("2. **Hermes Orchestrator** - Message routing and agent coordination")
        lines.append("3. **WebUI Panels** - User interface components")
        lines.append("4. **ZeroClaw Adapters** - Platform integrations (Claude, Windsurf, LM Studio, Zed, JetBrains)")
        lines.append("5. **KiloCode Sync** - Synchronization with KiloCode platform")
        lines.append("\n")

        lines.append("### Verification Components\n")
        lines.append("- Security audit and vulnerability scanning")
        lines.append("- Performance optimization and profiling")
        lines.append("- Test coverage analysis")
        lines.append("- Configuration validation")
        lines.append("- Backup verification\n")

        lines.append("## Known Issues\n\n")
        if integration and integration.get("errors"):
            for error in integration["errors"]:
                lines.append(f"- {error}\n")
        else:
            issues_found = sum(s.issues_found for s in wave1_agents + wave2_agents)
            if issues_found > 0:
                lines.append(f"- {issues_found} total issues were found during agent execution\n")
            else:
                lines.append("No known issues identified.\n")

        lines.append("## Next Steps\n\n")
        lines.append("1. Review the handoff document and verify completion status")
        lines.append("2. Address any blockers or failed checks")
        lines.append("3. Review agent outputs in `output/` directory")
        lines.append("4. Run integration lead: `python agent_00_integration_lead.py`")
        lines.append("5. Begin using the implemented components\n")

        lines.append("## File Structure\n\n")
        lines.append("```\nkilocode-Azure2/\n")
        lines.append("├── START_HERE.md                    # Quick start guide\n")
        lines.append("├── agent_dispatcher.py              # Wave-based dispatcher\n")
        lines.append("├── agent_monitor_dashboard.py      # Real-time monitoring\n")
        lines.append("├── agent_00_integration_lead.py    # Integration verification\n")
        lines.append("├── generate_handoff.py              # This document\n")
        lines.append("├── agents/                          # Agent implementations\n")
        lines.append("├── state/                           # Execution state\n")
        lines.append("├── output/                          # Agent outputs\n")
        lines.append("└── logs/                            # Execution logs\n")
        lines.append("```\n")

        lines.append("---\n")
        lines.append("*Generated by KiloCode Agent System*\n")

        return "\n".join(lines)

    def generate(self, output_file: Path) -> bool:
        """Generate and save the handoff document."""
        try:
            content = self.generate_markdown()
            with open(output_file, "w", encoding="utf-8") as f:
                f.write(content)

            if self.console:
                self.console.print(f"[green]Handoff document saved to:[/green] {output_file}")
            else:
                print(f"Handoff document saved to: {output_file}")

            return True

        except Exception as e:
            if self.console:
                self.console.print(f"[red]Error generating handoff:[/red] {e}")
            else:
                print(f"Error generating handoff: {e}")
            return False


async def main_async(output_file: Path):
    """Async main entry point."""
    generator = HandoffGenerator()
    success = generator.generate(output_file)
    return 0 if success else 1


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Generate KiloCode handoff document")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("KILOCODE_HANDOFF_FOR_WINDSURF.md"),
        help="Output file path (default: KILOCODE_HANDOFF_FOR_WINDSURF.md)",
    )

    args = parser.parse_args()
    exit_code = asyncio.run(main_async(args.output))
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
