"""
Integration Lead Agent - Verifies all components and reports status.

This module runs after all 20 agents complete to verify:
1. All agents completed successfully
2. Integration tests pass
3. Components are properly wired
4. No blockers remain

Usage:
    python agent_00_integration_lead.py
    python agent_00_integration_lead.py --check-only
    python agent_00_integration_lead.py --report integration_report.md
"""

import argparse
import asyncio
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

try:
    from rich.console import Console
    from rich.table import Table
    HAS_RICH = True
except ImportError:
    Console = None
    Table = None
    HAS_RICH = False


class IntegrationStatus(Enum):
    PENDING = "pending"
    CHECKING = "checking"
    PASSED = "passed"
    FAILED = "failed"
    WARNING = "warning"


@dataclass
class IntegrationCheck:
    """Result of a single integration check."""
    name: str
    description: str
    status: IntegrationStatus
    details: str = ""
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class IntegrationReport:
    """Overall integration report."""
    timestamp: str
    wave1_complete: bool
    wave2_complete: bool
    all_agents_complete: bool
    checks: list[IntegrationCheck] = field(default_factory=list)
    overall_status: IntegrationStatus = IntegrationStatus.PENDING
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


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


class IntegrationLead:
    """Lead agent for integration verification."""

    def __init__(self, base_path: Path | None = None):
        if base_path is None:
            base_path = Path(__file__).parent
        self.base_path = base_path
        self.state_file = base_path / "state" / "dispatcher_state.json"
        self.output_dir = base_path / "output"
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

    def _get_agent_status(self, agent_id: int) -> str:
        """Get status string for an agent."""
        state = self._read_state()
        if agent_id not in state:
            return "pending"
        return state[agent_id].get("status", "pending")

    def _is_wave_complete(self, wave: int) -> bool:
        """Check if a wave is complete."""
        agents = AGENTS_WAVE_1 if wave == 1 else AGENTS_WAVE_2
        agent_ids = {a["id"] for a in agents}

        for agent_id in agent_ids:
            status = self._get_agent_status(agent_id)
            if status not in ("completed", "failed"):
                return False
        return True

    def _check_agent_outputs_exist(self) -> IntegrationCheck:
        """Check that agent output files exist."""
        check = IntegrationCheck(
            name="Agent Outputs Exist",
            description="Verify all agent output files were created",
            status=IntegrationStatus.PENDING,
        )

        state = self._read_state()
        missing = []
        found = []

        for agent_id in range(1, 21):
            if agent_id not in state:
                missing.append(f"Agent {agent_id}: No state record")
                continue

            output_file = self.output_dir / f"agent_{agent_id:02d}_output.json"
            if output_file.exists():
                found.append(f"Agent {agent_id}")
            else:
                missing.append(f"Agent {agent_id}: {output_file}")

        if missing:
            check.status = IntegrationStatus.FAILED
            check.errors.extend(missing)
            check.details = f"Found {len(found)}/20 outputs"
        else:
            check.status = IntegrationStatus.PASSED
            check.details = f"All 20 agent outputs found"

        return check

    def _check_agent_completion(self) -> IntegrationCheck:
        """Check that all agents completed."""
        check = IntegrationCheck(
            name="Agent Completion",
            description="Verify all 20 agents completed successfully",
            status=IntegrationStatus.PENDING,
        )

        state = self._read_state()
        completed = []
        failed = []
        pending = []

        for agent in ALL_AGENTS:
            agent_id = agent["id"]
            if agent_id not in state:
                pending.append(f"Agent {agent_id}: {agent['name']}")
            elif state[agent_id].get("status") == "completed":
                completed.append(agent_id)
            elif state[agent_id].get("status") == "failed":
                failed.append(f"Agent {agent_id}: {state[agent_id].get('error_message', 'Unknown error')}")
            else:
                pending.append(f"Agent {agent_id}: {state[agent_id].get('status', 'unknown')}")

        if failed:
            check.status = IntegrationStatus.FAILED
            check.errors.extend(failed)
            check.details = f"{len(completed)}/20 completed, {len(failed)} failed"
        elif pending:
            check.status = IntegrationStatus.WARNING
            check.warnings.extend(pending)
            check.details = f"{len(completed)}/20 completed, {len(pending)} pending"
        else:
            check.status = IntegrationStatus.PASSED
            check.details = f"All 20 agents completed"

        return check

    def _check_wave1_complete(self) -> IntegrationCheck:
        """Check Wave 1 completion."""
        check = IntegrationCheck(
            name="Wave 1 Complete",
            description="Verify Wave 1 (Agents 1-10) is complete",
            status=IntegrationStatus.PENDING,
        )

        complete = self._is_wave_complete(1)
        if complete:
            check.status = IntegrationStatus.PASSED
            check.details = "Wave 1 all agents finished"
        else:
            incomplete = []
            for agent in AGENTS_WAVE_1:
                status = self._get_agent_status(agent["id"])
                if status not in ("completed", "failed"):
                    incomplete.append(f"Agent {agent['id']}: {agent['name']} ({status})")

            check.status = IntegrationStatus.FAILED
            check.errors.extend(incomplete)
            check.details = f"Wave 1 incomplete: {len(incomplete)} agents remaining"

        return check

    def _check_wave2_complete(self) -> IntegrationCheck:
        """Check Wave 2 completion."""
        check = IntegrationCheck(
            name="Wave 2 Complete",
            description="Verify Wave 2 (Agents 11-20) is complete",
            status=IntegrationStatus.PENDING,
        )

        complete = self._is_wave_complete(2)
        if complete:
            check.status = IntegrationStatus.PASSED
            check.details = "Wave 2 all agents finished"
        else:
            incomplete = []
            for agent in AGENTS_WAVE_2:
                status = self._get_agent_status(agent["id"])
                if status not in ("completed", "failed"):
                    incomplete.append(f"Agent {agent['id']}: {agent['name']} ({status})")

            check.status = IntegrationStatus.FAILED
            check.errors.extend(incomplete)
            check.details = f"Wave 2 incomplete: {len(incomplete)} agents remaining"

        return check

    def _check_no_blockers(self) -> IntegrationCheck:
        """Check for any remaining blockers."""
        check = IntegrationCheck(
            name="No Blockers",
            description="Verify no agents have blockers",
            status=IntegrationStatus.PENDING,
        )

        state = self._read_state()
        blockers = []

        for agent_id_str, agent_data in state.items():
            agent_blockers = agent_data.get("blockers", [])
            if agent_blockers:
                for blocker in agent_blockers:
                    blockers.append(f"Agent {agent_id_str}: {blocker}")

        if blockers:
            check.status = IntegrationStatus.WARNING
            check.warnings.extend(blockers)
            check.details = f"{len(blockers)} blocker(s) found"
        else:
            check.status = IntegrationStatus.PASSED
            check.details = "No blockers"

        return check

    def _check_integration_tests(self) -> IntegrationCheck:
        """Check integration test results."""
        check = IntegrationCheck(
            name="Integration Tests",
            description="Run and verify integration tests",
            status=IntegrationStatus.PENDING,
        )

        integration_output = self.output_dir / "agent_11_output.json"
        if not integration_output.exists():
            check.status = IntegrationStatus.FAILED
            check.errors.append("Integration test output not found")
            return check

        try:
            with open(integration_output, "r") as f:
                data = json.load(f)

            tests_passed = data.get("tests_passed", 0)
            tests_failed = data.get("tests_failed", 0)
            tests_total = data.get("tests_total", 0)

            if tests_failed > 0:
                check.status = IntegrationStatus.FAILED
                check.errors.append(f"{tests_failed}/{tests_total} tests failed")
                check.details = f"{tests_passed} passed, {tests_failed} failed"
            elif tests_total == 0:
                check.status = IntegrationStatus.WARNING
                check.warnings.append("No tests were run")
                check.details = "0 tests"
            else:
                check.status = IntegrationStatus.PASSED
                check.details = f"All {tests_total} tests passed"

        except (json.JSONDecodeError, TypeError) as e:
            check.status = IntegrationStatus.FAILED
            check.errors.append(f"Could not parse integration test output: {e}")

        return check

    def _check_component_wiring(self) -> IntegrationCheck:
        """Check that components are properly wired together."""
        check = IntegrationCheck(
            name="Component Wiring",
            description="Verify components are properly integrated",
            status=IntegrationStatus.PENDING,
        )

        issues = []

        runtime_output = self.output_dir / "agent_05_output.json"
        hermes_output = self.output_dir / "agent_06_output.json"
        webui_output = self.output_dir / "agent_07_output.json"
        zeroclaw_output = self.output_dir / "agent_08_output.json"
        kilocode_output = self.output_dir / "agent_09_output.json"

        if not runtime_output.exists():
            issues.append("Runtime core not implemented")
        if not hermes_output.exists():
            issues.append("Hermes orchestrator not implemented")
        if not webui_output.exists():
            issues.append("WebUI panels not implemented")
        if not zeroclaw_output.exists():
            issues.append("ZeroClaw adapters not implemented")
        if not kilocode_output.exists():
            issues.append("KiloCode sync not implemented")

        if issues:
            check.status = IntegrationStatus.FAILED
            check.errors.extend(issues)
            check.details = f"{5 - len(issues)}/5 core components found"
        else:
            check.status = IntegrationStatus.PASSED
            check.details = "All 5 core components implemented"

        return check

    def _check_zeroclaw_adapters(self) -> IntegrationCheck:
        """Check ZeroClaw adapters specifically."""
        check = IntegrationCheck(
            name="ZeroClaw Adapters",
            description="Verify ZeroClaw adapters (Claude, Windsurf, etc.)",
            status=IntegrationStatus.PENDING,
        )

        zeroclaw_output = self.output_dir / "agent_08_output.json"
        if not zeroclaw_output.exists():
            check.status = IntegrationStatus.FAILED
            check.errors.append("ZeroClaw output not found")
            return check

        try:
            with open(zeroclaw_output, "r") as f:
                data = json.load(f)

            adapters = data.get("adapters", {})
            expected = ["claude", "windsurf", "lmstudio", "zed", "jetbrains"]

            missing = [a for a in expected if a not in adapters]
            if missing:
                check.status = IntegrationStatus.WARNING
                check.warnings.extend(missing)
                check.details = f"{len(adapters)}/{len(expected)} adapters found"
            else:
                check.status = IntegrationStatus.PASSED
                check.details = f"All {len(expected)} adapters implemented"

        except (json.JSONDecodeError, TypeError) as e:
            check.status = IntegrationStatus.FAILED
            check.errors.append(f"Could not parse ZeroClaw output: {e}")

        return check

    def _check_kilocode_sync(self) -> IntegrationCheck:
        """Check KiloCode sync functionality."""
        check = IntegrationCheck(
            name="KiloCode Sync",
            description="Verify KiloCode synchronization",
            status=IntegrationStatus.PENDING,
        )

        kilocode_output = self.output_dir / "agent_09_output.json"
        if not kilocode_output.exists():
            check.status = IntegrationStatus.FAILED
            check.errors.append("KiloCode sync output not found")
            return check

        try:
            with open(kilocode_output, "r") as f:
                data = json.load(f)

            sync_features = data.get("sync_features", [])
            if len(sync_features) < 3:
                check.status = IntegrationStatus.WARNING
                check.warnings.append(f"Only {len(sync_features)} sync features found")
                check.details = f"{len(sync_features)} features"
            else:
                check.status = IntegrationStatus.PASSED
                check.details = f"{len(sync_features)} sync features"

        except (json.JSONDecodeError, TypeError) as e:
            check.status = IntegrationStatus.FAILED
            check.errors.append(f"Could not parse KiloCode output: {e}")

        return check

    def run_integration_checks(self, check_only: bool = False) -> IntegrationReport:
        """Run all integration checks."""
        report = IntegrationReport(
            timestamp=datetime.now().isoformat(),
            wave1_complete=self._is_wave_complete(1),
            wave2_complete=self._is_wave_complete(2),
            all_agents_complete=self._is_wave_complete(1) and self._is_wave_complete(2),
        )

        checks_to_run = [
            self._check_wave1_complete,
            self._check_wave2_complete,
            self._check_agent_completion,
            self._check_agent_outputs_exist,
            self._check_no_blockers,
            self._check_component_wiring,
            self._check_zeroclaw_adapters,
            self._check_kilocode_sync,
            self._check_integration_tests,
        ]

        for check_fn in checks_to_run:
            check = check_fn()
            report.checks.append(check)

            if check.status == IntegrationStatus.FAILED:
                report.errors.extend(check.errors)
            if check.status in (IntegrationStatus.WARNING, IntegrationStatus.FAILED):
                report.warnings.extend(check.warnings)

        failed_checks = sum(1 for c in report.checks if c.status == IntegrationStatus.FAILED)
        warning_checks = sum(1 for c in report.checks if c.status == IntegrationStatus.WARNING)

        if failed_checks > 0:
            report.overall_status = IntegrationStatus.FAILED
        elif warning_checks > 0:
            report.overall_status = IntegrationStatus.WARNING
        else:
            report.overall_status = IntegrationStatus.PASSED

        return report

    def print_report(self, report: IntegrationReport):
        """Print the integration report."""
        if not self.console:
            self._print_report_text(report)
            return

        self.console.print("\n[bold cyan]INTEGRATION LEAD REPORT[/bold cyan]")
        self.console.print(f"Timestamp: {report.timestamp}")
        self.console.print(f"Overall Status: {report.overall_status.value.upper()}")
        self.console.print("")

        status_table = Table(show_header=True)
        status_table.add_column("Check", style="cyan")
        status_table.add_column("Status", style="white")
        status_table.add_column("Details", style="dim")

        for check in report.checks:
            status_color = {
                IntegrationStatus.PASSED: "green",
                IntegrationStatus.FAILED: "red",
                IntegrationStatus.WARNING: "yellow",
                IntegrationStatus.PENDING: "dim",
                IntegrationStatus.CHECKING: "cyan",
            }.get(check.status, "white")

            status_icon = {
                IntegrationStatus.PASSED: "[green]✓[/green]",
                IntegrationStatus.FAILED: "[red]✗[/red]",
                IntegrationStatus.WARNING: "[yellow]![/yellow]",
                IntegrationStatus.PENDING: "[dim]-[/dim]",
                IntegrationStatus.CHECKING: "[cyan]...[/cyan]",
            }.get(check.status, "-")

            status_table.add_row(
                check.name,
                f"[{status_color}]{check.status.value}[/{status_color}]",
                check.details,
            )

        self.console.print(status_table)

        if report.errors:
            self.console.print("\n[bold red]ERRORS:[/bold red]")
            for error in report.errors:
                self.console.print(f"  [red]•[/red] {error}")

        if report.warnings:
            self.console.print("\n[bold yellow]WARNINGS:[/bold yellow]")
            for warning in report.warnings:
                self.console.print(f"  [yellow]•[/yellow] {warning}")

        self.console.print(f"\n[bold]Overall:[/bold] {report.overall_status.value.upper()}")

    def _print_report_text(self, report: IntegrationReport):
        """Print report as plain text."""
        print("\n" + "=" * 70)
        print("INTEGRATION LEAD REPORT")
        print("=" * 70)
        print(f"Timestamp: {report.timestamp}")
        print(f"Overall Status: {report.overall_status.value.upper()}")
        print("")
        print("CHECKS:")
        for check in report.checks:
            icon = {"passed": "✓", "failed": "✗", "warning": "!", "pending": "-", "checking": "..."}.get(check.status.value, "-")
            print(f"  [{icon}] {check.name}: {check.status.value} - {check.details}")

        if report.errors:
            print("\nERRORS:")
            for error in report.errors:
                print(f"  ✗ {error}")

        if report.warnings:
            print("\nWARNINGS:")
            for warning in report.warnings:
                print(f"  ! {warning}")

        print(f"\nOverall: {report.overall_status.value.upper()}")
        print("=" * 70 + "\n")

    def save_report(self, report: IntegrationReport, output_file: Path):
        """Save report to file."""
        data = {
            "timestamp": report.timestamp,
            "overall_status": report.overall_status.value,
            "wave1_complete": report.wave1_complete,
            "wave2_complete": report.wave2_complete,
            "all_agents_complete": report.all_agents_complete,
            "checks": [
                {
                    "name": c.name,
                    "description": c.description,
                    "status": c.status.value,
                    "details": c.details,
                    "errors": c.errors,
                    "warnings": c.warnings,
                }
                for c in report.checks
            ],
            "errors": report.errors,
            "warnings": report.warnings,
        }

        with open(output_file, "w") as f:
            json.dump(data, f, indent=2)

        print(f"Report saved to: {output_file}")


async def main_async(check_only: bool = False, report_file: Path | None = None):
    """Async main entry point."""
    lead = IntegrationLead()
    report = lead.run_integration_checks(check_only)
    lead.print_report(report)

    if report_file:
        lead.save_report(report, report_file)

    return 0 if report.overall_status in (IntegrationStatus.PASSED, IntegrationStatus.WARNING) else 1


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="KiloCode Integration Lead")
    parser.add_argument("--check-only", action="store_true", help="Only run checks, don't fail on warnings")
    parser.add_argument("--report", type=Path, help="Save report to file")

    args = parser.parse_args()
    exit_code = asyncio.run(main_async(args.check_only, args.report))
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
