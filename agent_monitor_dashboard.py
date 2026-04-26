"""
Agent Monitor Dashboard - Real-time monitoring of agent execution.

This dashboard provides a live view of agent status, progress,
issues, blockers, and ETA calculations.

Usage:
    python agent_monitor_dashboard.py
    python agent_monitor_dashboard.py --refresh 2
    python agent_monitor_dashboard.py --json
"""

import argparse
import asyncio
import json
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from pathlib import Path
from typing import Any

try:
    from rich.console import Console
    from rich.live import Live
    from rich.layout import Layout
    from rich.panel import Panel
    from rich.progress import Progress, BarColumn, TextColumn, TimeRemainingColumn
    from rich.table import Table
    from rich.text import Text
    from rich.tree import Tree
    HAS_RICH = True
except ImportError:
    Console = None
    Live = None
    Layout = None
    Panel = None
    Table = None
    Text = None
    Tree = None
    HAS_RICH = False


class AgentStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    BLOCKED = "blocked"
    RETRY = "retry"


@dataclass
class AgentSnapshot:
    """Snapshot of agent state."""
    agent_id: int
    agent_name: str
    status: AgentStatus
    started_at: str | None = None
    completed_at: str | None = None
    duration_seconds: float = 0.0
    issues_found: int = 0
    blockers: list[str] = field(default_factory=list)
    last_heartbeat: str | None = None
    memory_mb: float = 0.0
    cpu_percent: float = 0.0


AGENTS_WAVE_1 = [
    {"id": 1, "name": "Audit Source Paths", "module": "agents.agent_01_source_audit"},
    {"id": 2, "name": "Audit Configs", "module": "agents.agent_02_config_audit"},
    {"id": 3, "name": "Audit Docs", "module": "agents.agent_03_doc_audit"},
    {"id": 4, "name": "Audit Tests", "module": "agents.agent_04_test_audit"},
    {"id": 5, "name": "Implement Runtime Core", "module": "agents.agent_05_runtime_impl"},
    {"id": 6, "name": "Implement Hermes Orchestrator", "module": "agents.agent_06_hermes_impl"},
    {"id": 7, "name": "Implement WebUI Panels", "module": "agents.agent_07_webui_impl"},
    {"id": 8, "name": "Implement ZeroClaw Adapters", "module": "agents.agent_08_zeroclaw_impl"},
    {"id": 9, "name": "Implement KiloCode Sync", "module": "agents.agent_09_kilocode_impl"},
    {"id": 10, "name": "Create Proof Module", "module": "agents.agent_10_proof_impl"},
]

AGENTS_WAVE_2 = [
    {"id": 11, "name": "Integration Testing", "module": "agents.agent_11_integration"},
    {"id": 12, "name": "Security Audit", "module": "agents.agent_12_security"},
    {"id": 13, "name": "Performance Optimization", "module": "agents.agent_13_performance"},
    {"id": 14, "name": "Documentation Review", "module": "agents.agent_14_doc_review"},
    {"id": 15, "name": "Config Validation", "module": "agents.agent_15_config_val"},
    {"id": 16, "name": "Test Coverage", "module": "agents.agent_16_coverage"},
    {"id": 17, "name": "Deployment Prep", "module": "agents.agent_17_deploy_prep"},
    {"id": 18, "name": "Monitoring Setup", "module": "agents.agent_18_monitoring"},
    {"id": 19, "name": "Backup Verification", "module": "agents.agent_19_backup"},
    {"id": 20, "name": "Final Review", "module": "agents.agent_20_review"},
]

ALL_AGENTS = AGENTS_WAVE_1 + AGENTS_WAVE_2


class StateReader:
    """Reads agent state from disk."""

    def __init__(self, state_dir: Path | None = None):
        if state_dir is None:
            state_dir = Path(__file__).parent / "state"
        self.state_dir = state_dir
        self.state_file = state_dir / "dispatcher_state.json"

    def read_snapshots(self) -> list[AgentSnapshot]:
        """Read all agent snapshots from state."""
        snapshots = []

        if not self.state_file.exists():
            for agent in ALL_AGENTS:
                snapshots.append(AgentSnapshot(
                    agent_id=agent["id"],
                    agent_name=agent["name"],
                    status=AgentStatus.PENDING,
                ))
            return snapshots

        try:
            with open(self.state_file, "r") as f:
                data = json.load(f)

            for agent_id_str, agent_data in data.items():
                agent_id = int(agent_id_str)
                agent_info = next((a for a in ALL_AGENTS if a["id"] == agent_id), None)
                agent_name = agent_info["name"] if agent_info else f"Agent {agent_id}"

                snapshots.append(AgentSnapshot(
                    agent_id=agent_id,
                    agent_name=agent_name,
                    status=AgentStatus(agent_data.get("status", "pending")),
                    started_at=agent_data.get("started_at"),
                    completed_at=agent_data.get("completed_at"),
                    duration_seconds=agent_data.get("duration_seconds", 0.0),
                    issues_found=agent_data.get("issues_found", 0),
                    blockers=agent_data.get("blockers", []),
                ))

        except (json.JSONDecodeError, TypeError, ValueError) as e:
            print(f"Warning: Could not read state: {e}")

        for agent in ALL_AGENTS:
            if not any(s.agent_id == agent["id"] for s in snapshots):
                snapshots.append(AgentSnapshot(
                    agent_id=agent["id"],
                    agent_name=agent["name"],
                    status=AgentStatus.PENDING,
                ))

        return sorted(snapshots, key=lambda s: s.agent_id)

    def get_wave_completion(self, wave: int) -> float:
        """Get completion percentage for a wave."""
        agents = AGENTS_WAVE_1 if wave == 1 else AGENTS_WAVE_2
        agent_ids = {a["id"] for a in agents}
        snapshots = [s for s in self.read_snapshots() if s.agent_id in agent_ids]

        if not snapshots:
            return 0.0

        completed = sum(1 for s in snapshots if s.status == AgentStatus.COMPLETED)
        return (completed / len(snapshots)) * 100


class Dashboard:
    """Terminal dashboard for agent monitoring."""

    SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
    STATUS_COLORS = {
        AgentStatus.PENDING: "white",
        AgentStatus.RUNNING: "cyan",
        AgentStatus.COMPLETED: "green",
        AgentStatus.FAILED: "red",
        AgentStatus.BLOCKED: "yellow",
        AgentStatus.RETRY: "magenta",
    }

    def __init__(self, refresh_rate: float = 2.0, use_rich: bool = True):
        self.refresh_rate = refresh_rate
        self.use_rich = use_rich and HAS_RICH
        self.state_reader = StateReader()
        self.console = Console() if HAS_RICH else None
        self.spinner_index = 0
        self.start_time = time.time()

    def _get_elapsed_time(self) -> str:
        """Get elapsed time since dashboard start."""
        elapsed = time.time() - self.start_time
        hours = int(elapsed // 3600)
        minutes = int((elapsed % 3600) // 60)
        seconds = int(elapsed % 60)
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"

    def _get_eta_to_next_wave(self) -> str:
        """Estimate ETA to next wave."""
        wave1_complete = self.state_reader.get_wave_completion(1) >= 100.0
        if not wave1_complete:
            remaining = 100.0 - self.state_reader.get_wave_completion(1)
            estimated_minutes = remaining / 100 * 360
            return f"~{estimated_minutes:.0f}min"
        wave2_complete = self.state_reader.get_wave_completion(2) >= 100.0
        if not wave2_complete:
            remaining = 100.0 - self.state_reader.get_wave_completion(2)
            estimated_minutes = remaining / 100 * 360
            return f"~{estimated_minutes:.0f}min"
        return "COMPLETE"

    def _get_active_agents_count(self) -> int:
        """Get count of running agents."""
        snapshots = self.state_reader.read_snapshots()
        return sum(1 for s in snapshots if s.status == AgentStatus.RUNNING)

    def _get_total_issues(self) -> int:
        """Get total issues found."""
        snapshots = self.state_reader.read_snapshots()
        return sum(s.issues_found for s in snapshots)

    def _get_all_blockers(self) -> list[tuple[int, str]]:
        """Get all blockers with agent IDs."""
        snapshots = self.state_reader.read_snapshots()
        blockers = []
        for s in snapshots:
            for blocker in s.blockers:
                blockers.append((s.agent_id, blocker))
        return blockers

    def _build_progress_bar(self, percentage: float, width: int = 40) -> str:
        """Build ASCII progress bar."""
        filled = int(width * percentage / 100)
        empty = width - filled
        bar = "█" * filled + "░" * empty
        return f"[{bar}] {percentage:.1f}%"

    def render_text(self) -> str:
        """Render dashboard as plain text."""
        snapshots = self.state_reader.read_snapshots()
        wave1_completion = self.state_reader.get_wave_completion(1)
        wave2_completion = self.state_reader.get_wave_completion(2)

        lines = []
        lines.append("=" * 80)
        lines.append("KILOCODE AGENT MONITOR DASHBOARD")
        lines.append("=" * 80)
        lines.append(f"Refresh: {self.refresh_rate}s | Elapsed: {self._get_elapsed_time()}")
        lines.append(f"Active Agents: {self._get_active_agents_count()} | Total Issues: {self._get_total_issues()}")
        lines.append(f"ETA to Next Wave: {self._get_eta_to_next_wave()}")
        lines.append("")

        lines.append(f"WAVE 1: {self._build_progress_bar(wave1_completion)}")
        for snapshot in snapshots:
            if snapshot.agent_id <= 10:
                spinner = self.SPINNER_FRAMES[self.spinner_index % len(self.SPINNER_FRAMES)] if snapshot.status == AgentStatus.RUNNING else " "
                status_str = snapshot.status.value.upper()
                duration_str = f"{snapshot.duration_seconds:.0f}s" if snapshot.duration_seconds else "-"
                issues_str = f"!{snapshot.issues_found}" if snapshot.issues_found else ""
                lines.append(f"  {spinner} Agent {snapshot.agent_id:02d}: {snapshot.agent_name:<30} {status_str:>10} {duration_str:>8} {issues_str}")

        lines.append("")
        lines.append(f"WAVE 2: {self._build_progress_bar(wave2_completion)}")
        for snapshot in snapshots:
            if snapshot.agent_id > 10:
                spinner = self.SPINNER_FRAMES[self.spinner_index % len(self.SPINNER_FRAMES)] if snapshot.status == AgentStatus.RUNNING else " "
                status_str = snapshot.status.value.upper()
                duration_str = f"{snapshot.duration_seconds:.0f}s" if snapshot.duration_seconds else "-"
                issues_str = f"!{snapshot.issues_found}" if snapshot.issues_found else ""
                lines.append(f"  {spinner} Agent {snapshot.agent_id:02d}: {snapshot.agent_name:<30} {status_str:>10} {duration_str:>8} {issues_str}")

        blockers = self._get_all_blockers()
        if blockers:
            lines.append("")
            lines.append("BLOCKERS:")
            for agent_id, blocker in blockers:
                lines.append(f"  [Agent {agent_id:02d}] {blocker}")

        lines.append("=" * 80)
        lines.append(f"Updated: {datetime.now():%H:%M:%S}")
        lines.append("=" * 80)

        return "\n".join(lines)

    def render_rich(self) -> Layout:
        """Render dashboard using Rich library."""
        if not self.console:
            raise RuntimeError("Rich not available")

        layout = Layout()
        snapshots = self.state_reader.read_snapshots()
        wave1_completion = self.state_reader.get_wave_completion(1)
        wave2_completion = self.state_reader.get_wave_completion(2)

        header = Panel(
            f"[bold cyan]KILOCODE AGENT MONITOR[/bold cyan]\n"
            f"Refresh: {self.refresh_rate}s | Elapsed: {self._get_elapsed_time()}\n"
            f"Active: {self._get_active_agents_count()} | Issues: {self._get_total_issues()} | ETA: {self._get_eta_to_next_wave()}",
            title="Status",
            border_style="cyan",
        )

        wave1_table = Table(title="Wave 1 (Agents 1-10)", show_header=True)
        wave1_table.add_column("ID", style="cyan", width=3)
        wave1_table.add_column("Agent", style="white")
        wave1_table.add_column("Status", style="green")
        wave1_table.add_column("Duration", style="yellow")
        wave1_table.add_column("Issues", style="red")

        for snapshot in snapshots:
            if snapshot.agent_id <= 10:
                status_color = self.STATUS_COLORS.get(snapshot.status, "white")
                duration = f"{snapshot.duration_seconds:.0f}s" if snapshot.duration_seconds else "-"
                issues = str(snapshot.issues_found) if snapshot.issues_found else "-"
                wave1_table.add_row(
                    str(snapshot.agent_id),
                    snapshot.agent_name,
                    f"[{status_color}]{snapshot.status.value}[/{status_color}]",
                    duration,
                    issues,
                )

        wave2_table = Table(title="Wave 2 (Agents 11-20)", show_header=True)
        wave2_table.add_column("ID", style="cyan", width=3)
        wave2_table.add_column("Agent", style="white")
        wave2_table.add_column("Status", style="green")
        wave2_table.add_column("Duration", style="yellow")
        wave2_table.add_column("Issues", style="red")

        for snapshot in snapshots:
            if snapshot.agent_id > 10:
                status_color = self.STATUS_COLORS.get(snapshot.status, "white")
                duration = f"{snapshot.duration_seconds:.0f}s" if snapshot.duration_seconds else "-"
                issues = str(snapshot.issues_found) if snapshot.issues_found else "-"
                wave2_table.add_row(
                    str(snapshot.agent_id),
                    snapshot.agent_name,
                    f"[{status_color}]{snapshot.status.value}[/{status_color}]",
                    duration,
                    issues,
                )

        blockers = self._get_all_blockers()
        blockers_tree = Tree("[bold yellow]Blockers[/bold yellow]")
        if blockers:
            for agent_id, blocker in blockers:
                blockers_tree.add(f"[red]Agent {agent_id:02d}:[/red] {blocker}")
        else:
            blockers_tree.add("[green]No blockers[/green]")

        progress_text = f"[cyan]Wave 1:[/cyan] {wave1_completion:.1f}% | [cyan]Wave 2:[/cyan] {wave2_completion:.1f}%"

        layout.split_column(
            Layout(header, name="header", size=5),
            Layout(wave1_table, name="wave1", ratio=1),
            Layout(wave2_table, name="wave2", ratio=1),
            Layout(blockers_tree, name="blockers", ratio=1),
            Layout(f"[bold]Progress:[/bold] {progress_text}", name="progress", size=3),
        )

        return layout

    def render_json(self) -> str:
        """Render dashboard as JSON."""
        snapshots = self.state_reader.read_snapshots()
        data = {
            "timestamp": datetime.now().isoformat(),
            "elapsed_seconds": time.time() - self.start_time,
            "wave1_completion": self.state_reader.get_wave_completion(1),
            "wave2_completion": self.state_reader.get_wave_completion(2),
            "active_agents": self._get_active_agents_count(),
            "total_issues": self._get_total_issues(),
            "eta_to_next_wave": self._get_eta_to_next_wave(),
            "agents": [
                {
                    "id": s.agent_id,
                    "name": s.agent_name,
                    "status": s.status.value,
                    "duration_seconds": s.duration_seconds,
                    "issues_found": s.issues_found,
                    "blockers": s.blockers,
                }
                for s in snapshots
            ],
            "blockers": [
                {"agent_id": agent_id, "message": blocker}
                for agent_id, blocker in self._get_all_blockers()
            ],
        }
        return json.dumps(data, indent=2)

    async def run_async(self, json_output: bool = False):
        """Run the dashboard asynchronously."""
        if json_output:
            print(self.render_json())
            return

        if self.use_rich and self.console:
            with Live(self.render_rich(), refresh_per_second=1/self.refresh_rate, console=self.console) as live:
                while True:
                    self.spinner_index += 1
                    live.update(self.render_rich())
                    await asyncio.sleep(self.refresh_rate)
        else:
            while True:
                self.spinner_index += 1
                print("\033[2J\033[H")
                print(self.render_text())
                await asyncio.sleep(self.refresh_rate)

    def run(self, json_output: bool = False):
        """Run the dashboard."""
        try:
            asyncio.run(self.run_async(json_output))
        except KeyboardInterrupt:
            print("\nDashboard stopped.")
            sys.exit(0)


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="KiloCode Agent Monitor Dashboard")
    parser.add_argument("--refresh", type=float, default=2.0, help="Refresh rate in seconds (default: 2.0)")
    parser.add_argument("--json", action="store_true", help="Output JSON instead of dashboard")
    parser.add_argument("--no-rich", action="store_true", help="Disable Rich library features")

    args = parser.parse_args()

    dashboard = Dashboard(
        refresh_rate=args.refresh,
        use_rich=not args.no_rich and HAS_RICH,
    )
    dashboard.run(json_output=args.json)


if __name__ == "__main__":
    main()
