"""
Agent Dispatcher - Wave-based agent execution for KiloCode.

This module dispatches agents in waves, tracks their execution,
and manages the overall agent workflow.

Usage:
    python agent_dispatcher.py --wave 1    # Dispatch Wave 1 (Agents 1-10)
    python agent_dispatcher.py --wave 2    # Dispatch Wave 2 (Agents 11-20)
    python agent_dispatcher.py --list      # List all agents
    python agent_dispatcher.py --status    # Show current status
"""

import asyncio
import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from enum import Enum
from pathlib import Path
from typing import Any

import httpx

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


class AgentStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    BLOCKED = "blocked"
    RETRY = "retry"


@dataclass
class AgentResult:
    """Result from an agent execution."""
    agent_id: int
    agent_name: str
    status: AgentStatus
    started_at: str | None = None
    completed_at: str | None = None
    duration_seconds: float = 0.0
    output_file: str | None = None
    error_message: str | None = None
    retry_count: int = 0
    issues_found: int = 0
    blockers: list[str] = field(default_factory=list)


class StateManager:
    """Manages agent execution state persistence."""

    def __init__(self, state_dir: Path | None = None):
        if state_dir is None:
            state_dir = Path(__file__).parent / "state"
        self.state_dir = state_dir
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.state_file = self.state_dir / "dispatcher_state.json"
        self._state: dict[int, AgentResult] = {}
        self._load_state()

    def _load_state(self):
        """Load state from disk."""
        if self.state_file.exists():
            try:
                with open(self.state_file, "r") as f:
                    data = json.load(f)
                    for agent_id, agent_data in data.items():
                        agent_data["status"] = AgentStatus(agent_data["status"])
                        self._state[int(agent_id)] = AgentResult(**agent_data)
            except (json.JSONDecodeError, TypeError) as e:
                print(f"Warning: Could not load state: {e}")
                self._state = {}

    def _save_state(self):
        """Save state to disk."""
        data = {
            agent_id: asdict(result)
            for agent_id, result in self._state.items()
        }
        data = {
            k: {**v, "status": v["status"].value}
            for k, v in data.items()
        }
        with open(self.state_file, "w") as f:
            json.dump(data, f, indent=2)

    def get_result(self, agent_id: int) -> AgentResult | None:
        """Get result for an agent."""
        return self._state.get(agent_id)

    def set_result(self, result: AgentResult):
        """Set result for an agent."""
        self._state[result.agent_id] = result
        self._save_state()

    def get_wave_results(self, wave: int) -> list[AgentResult]:
        """Get all results for a wave."""
        agents = AGENTS_WAVE_1 if wave == 1 else AGENTS_WAVE_2
        agent_ids = {a["id"] for a in agents}
        return [self._state[a_id] for a_id in sorted(agent_ids) if a_id in self._state]

    def get_completion_percentage(self, wave: int) -> float:
        """Get completion percentage for a wave."""
        results = self.get_wave_results(wave)
        if not results:
            return 0.0
        completed = sum(1 for r in results if r.status == AgentStatus.COMPLETED)
        return (completed / len(results)) * 100

    def is_wave_complete(self, wave: int) -> bool:
        """Check if a wave is complete."""
        results = self.get_wave_results(wave)
        if not results:
            return False
        return all(r.status in (AgentStatus.COMPLETED, AgentStatus.FAILED) for r in results)

    def reset_wave(self, wave: int):
        """Reset all agents in a wave to pending."""
        agents = AGENTS_WAVE_1 if wave == 1 else AGENTS_WAVE_2
        for agent in agents:
            self._state.pop(agent["id"], None)
        self._save_state()


class AgentDispatcher:
    """Dispatches and manages agent execution."""

    def __init__(self, base_url: str = "http://localhost:8080", max_retries: int = 3):
        self.base_url = base_url
        self.max_retries = max_retries
        self.state_manager = StateManager()
        self.output_dir = Path(__file__).parent / "output"
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.log_dir = Path(__file__).parent / "logs"
        self.log_dir.mkdir(parents=True, exist_ok=True)

    def _get_agent_module_path(self, module: str) -> Path:
        """Get the path to an agent module."""
        agents_dir = Path(__file__).parent / "agents"
        return agents_dir / f"{module.split('.')[-1]}.py"

    async def dispatch_single_agent(
        self,
        agent_config: dict[str, Any],
        timeout: int = 3600,
    ) -> AgentResult:
        """Dispatch a single agent and wait for completion."""
        agent_id = agent_config["id"]
        agent_name = agent_config["name"]
        module = agent_config["module"]

        print(f"\n[{datetime.now():%H:%M:%S}] Starting Agent {agent_id}: {agent_name}")

        result = AgentResult(
            agent_id=agent_id,
            agent_name=agent_name,
            status=AgentStatus.RUNNING,
            started_at=datetime.now().isoformat(),
        )
        self.state_manager.set_result(result)

        log_file = self.log_dir / f"agent_{agent_id:02d}_{int(time.time())}.log"
        output_file = self.output_dir / f"agent_{agent_id:02d}_output.json"

        try:
            module_path = self._get_agent_module_path(module)
            if not module_path.exists():
                module_path = Path(__file__).parent / f"{module}.py"

            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(
                    f"{self.base_url}/agents/dispatch",
                    json={
                        "agent_id": agent_id,
                        "agent_name": agent_name,
                        "module": module,
                        "module_path": str(module_path),
                        "output_file": str(output_file),
                        "log_file": str(log_file),
                    },
                )
                response.raise_for_status()
                data = response.json()

                result.status = AgentStatus(data.get("status", "completed"))
                result.output_file = data.get("output_file", str(output_file))
                result.issues_found = data.get("issues_found", 0)
                result.blockers = data.get("blockers", [])

        except httpx.HTTPError as e:
            result.status = AgentStatus.FAILED
            result.error_message = f"HTTP error: {str(e)}"
            print(f"[{datetime.now():%H:%M:%S}] Agent {agent_id} FAILED: {e}")

        except Exception as e:
            result.status = AgentStatus.FAILED
            result.error_message = str(e)
            print(f"[{datetime.now():%H:%M:%S}] Agent {agent_id} ERROR: {e}")

        finally:
            result.completed_at = datetime.now().isoformat()
            if result.started_at and result.completed_at:
                start = datetime.fromisoformat(result.started_at)
                end = datetime.fromisoformat(result.completed_at)
                result.duration_seconds = (end - start).total_seconds()

            self.state_manager.set_result(result)

            status_str = result.status.value.upper()
            duration_str = f"{result.duration_seconds:.1f}s"
            print(
                f"[{datetime.now():%H:%M:%S}] Agent {agent_id} {status_str} "
                f"({duration_str})"
            )

        return result

    async def dispatch_wave(
        self,
        wave_num: int,
        max_concurrent: int = 5,
        delay_between: float = 2.0,
    ) -> list[AgentResult]:
        """Dispatch all agents in a wave with concurrency control."""
        agents = AGENTS_WAVE_1 if wave_num == 1 else AGENTS_WAVE_2

        print(f"\n{'=' * 70}")
        print(f"WAVE {wave_num} - {len(agents)} AGENTS")
        print(f"{'=' * 70}")
        print(f"Started: {datetime.now():%Y-%m-%d %H:%M:%S}")
        print(f"Max concurrent: {max_concurrent}")
        print(f"Delay between batches: {delay_between}s")
        print(f"{'=' * 70}\n")

        results = []
        total_batches = (len(agents) + max_concurrent - 1) // max_concurrent

        for batch_num in range(total_batches):
            batch_start = batch_num * max_concurrent
            batch_end = min(batch_start + max_concurrent, len(agents))
            batch = agents[batch_start:batch_end]

            print(f"\n--- Batch {batch_num + 1}/{total_batches} ---")
            for agent in batch:
                print(f"  Agent {agent['id']:02d}: {agent['name']}")

            tasks = [self.dispatch_single_agent(agent) for agent in batch]
            batch_results = await asyncio.gather(*tasks, return_exceptions=True)

            for i, batch_result in enumerate(batch_results):
                if isinstance(batch_result, Exception):
                    agent = batch[i]
                    result = AgentResult(
                        agent_id=agent["id"],
                        agent_name=agent["name"],
                        status=AgentStatus.FAILED,
                        error_message=str(batch_result),
                    )
                    batch_results[i] = result

            results.extend(batch_results)

            if batch_end < len(agents) and delay_between > 0:
                print(f"\nWaiting {delay_between}s before next batch...")
                await asyncio.sleep(delay_between)

        wave_duration = sum(r.duration_seconds for r in results if r.duration_seconds)
        completed = sum(1 for r in results if r.status == AgentStatus.COMPLETED)
        failed = sum(1 for r in results if r.status == AgentStatus.FAILED)

        print(f"\n{'=' * 70}")
        print(f"WAVE {wave_num} COMPLETE")
        print(f"{'=' * 70}")
        print(f"Total agents: {len(agents)}")
        print(f"Completed: {completed}")
        print(f"Failed: {failed}")
        print(f"Total duration: {wave_duration:.1f}s")
        print(f"Completion: {self.state_manager.get_completion_percentage(wave_num):.1f}%")
        print(f"{'=' * 70}\n")

        return results

    def list_agents(self, wave: int | None = None):
        """List all agents or agents in a specific wave."""
        if wave == 1:
            agents = AGENTS_WAVE_1
        elif wave == 2:
            agents = AGENTS_WAVE_2
        else:
            agents = ALL_AGENTS

        print(f"\n{'=' * 70}")
        print(f"AGENTS {'(Wave ' + str(wave) + ')' if wave else '(All)'} - {len(agents)} total")
        print(f"{'=' * 70}")

        for agent in agents:
            result = self.state_manager.get_result(agent["id"])
            status = result.status.value if result else "pending"
            duration = f"{result.duration_seconds:.1f}s" if result and result.duration_seconds else "-"
            issues = result.issues_found if result and result.issues_found else "-"

            print(f"  {agent['id']:02d}. {agent['name']:<35} [{status:>10}] {duration:>10} issues:{issues}")

        print(f"{'=' * 70}\n")

    def show_status(self):
        """Show overall status."""
        wave1_pct = self.state_manager.get_completion_percentage(1)
        wave2_pct = self.state_manager.get_completion_percentage(2)

        wave1_complete = self.state_manager.is_wave_complete(1)
        wave2_complete = self.state_manager.is_wave_complete(2)

        print(f"\n{'=' * 70}")
        print("DISPATCHER STATUS")
        print(f"{'=' * 70}")
        print(f"Wave 1: {wave1_pct:.1f}% complete {'[COMPLETE]' if wave1_complete else ''}")
        print(f"Wave 2: {wave2_pct:.1f}% complete {'[COMPLETE]' if wave2_complete else ''}")
        print(f"Overall: {(wave1_pct + wave2_pct) / 2:.1f}% complete")
        print(f"State file: {self.state_manager.state_file}")
        print(f"{'=' * 70}\n")


async def main_async(wave: int | None = None, list_agents: bool = False, show_status: bool = False,
                     max_concurrent: int = 5, delay_between: float = 2.0):
    """Async main entry point."""
    dispatcher = AgentDispatcher()

    if list_agents:
        dispatcher.list_agents(wave)
        return

    if show_status:
        dispatcher.show_status()
        return

    if wave is None:
        print("Error: --wave is required. Use --wave 1 or --wave 2")
        print("Or use --list to see all agents, --status for current status")
        sys.exit(1)

    if wave not in (1, 2):
        print(f"Error: Invalid wave {wave}. Use --wave 1 or --wave 2")
        sys.exit(1)

    await dispatcher.dispatch_wave(wave, max_concurrent, delay_between)


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="KiloCode Agent Dispatcher - Wave-based agent execution",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python agent_dispatcher.py --wave 1              Dispatch Wave 1
  python agent_dispatcher.py --wave 2              Dispatch Wave 2
  python agent_dispatcher.py --list                List all agents
  python agent_dispatcher.py --list --wave 1       List Wave 1 agents
  python agent_dispatcher.py --status              Show dispatcher status
  python agent_dispatcher.py --wave 1 --concurrent 10  More parallelism
        """
    )

    parser.add_argument("--wave", type=int, choices=[1, 2], help="Wave number (1 or 2)")
    parser.add_argument("--list", action="store_true", help="List all agents")
    parser.add_argument("--status", action="store_true", help="Show current status")
    parser.add_argument("--concurrent", type=int, default=5, help="Max concurrent agents (default: 5)")
    parser.add_argument("--delay", type=float, default=2.0, help="Delay between batches in seconds (default: 2.0)")
    parser.add_argument("--reset", type=int, choices=[1, 2], help="Reset a wave (clear all results)")

    args = parser.parse_args()

    if args.reset:
        state_manager = StateManager()
        state_manager.reset_wave(args.reset)
        print(f"Wave {args.reset} has been reset.")
        return

    asyncio.run(main_async(
        wave=args.wave,
        list_agents=args.list,
        show_status=args.status,
        max_concurrent=args.concurrent,
        delay_between=args.delay,
    ))


if __name__ == "__main__":
    main()
