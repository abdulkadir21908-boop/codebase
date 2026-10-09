#!/usr/bin/env python3
"""
Deep Research Agent - Interactive CLI

Commands:
    <topic>         Research any topic
    depth <1-3>     Set research depth
    sources <n>     Set max sources to scrape
    history         Show past research topics
    read <n>        Open report #n in default viewer
    help            Show commands
    exit            Quit
"""

import os
import sys
import glob
import subprocess
import platform

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
if sys.stdout.encoding != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8")
if sys.stderr.encoding != "utf-8":
    sys.stderr.reconfigure(encoding="utf-8")

from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.markdown import Markdown
from rich.text import Text

from research_agent.agent import DeepResearchAgent, AgentConfig

console = Console(force_terminal=True)

BANNER = r"""
[bold cyan]
  ____              _  ____  _____  ____  _     _____
 |  _ \  __ _ _   _| |/ ___||___ // ___|| |   |___ /
 | | | |/ _` | | | | | |      _ \___ \| |     |_ \
 | |_| | (_| | |_| | | |___ ___) |__) | |___ ___) |
 |____/ \__,_|\__, |_|\____|____/|____/|_____|____/
              |___/
[/]
[dim]Pure Code  |  No LLM  |  Just Research[/]

[dim]Type a topic to research, or 'help' for commands.[/]
"""

HELP_TEXT = """
[bold cyan]Commands[/]
  [white]<topic>[/]          Research any topic (just type it)
  [white]depth <1-3>[/]     Set depth: 1=quick, 2=medium, 3=deep
  [white]sources <n>[/]     Set max pages to scrape (default 12)
  [white]history[/]         Show past research reports
  [white]read <n>[/]        Open report #n from history
  [white]open[/]            Open reports folder
  [white]clear[/]           Clear screen
  [white]help[/]            Show this message
  [white]exit / quit[/]     Exit
"""


class ResearchCLI:
    def __init__(self):
        self.depth = 2
        self.max_sources = 12
        self.output_dir = "reports"
        os.makedirs(self.output_dir, exist_ok=True)
        self.history: list[tuple[str, str]] = []  # (topic, report_path)
        self._load_history()

    def _load_history(self):
        files = sorted(glob.glob(os.path.join(self.output_dir, "*.md")), reverse=True)
        self.history = []
        for f in files:
            basename = os.path.splitext(os.path.basename(f))[0]
            topic = basename.rsplit("_", 2)[0].replace("_", " ")
            self.history.append((topic, f))

    def _open_file(self, path: str):
        if platform.system() == "Windows":
            os.startfile(path)
        elif platform.system() == "Darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])

    def display_results(self, result):
        console.print()

        console.print(Panel(
            Markdown(result.analysis.summary),
            title="[bold green]Executive Summary[/]",
            border_style="green",
        ))

        if result.analysis.key_findings:
            table = Table(show_lines=True, border_style="dim")
            table.add_column("#", style="bold cyan", width=3)
            table.add_column("Finding", style="white")
            for i, f in enumerate(result.analysis.key_findings, 1):
                table.add_row(str(i), f)
            console.print(table)

        if result.analysis.keywords:
            kw_str = "  ".join(f"[cyan]{kw}[/]" for kw in result.analysis.keywords[:15])
            console.print(f"\n[bold]Keywords:[/] {kw_str}")

        if result.sources:
            src_table = Table(title=f"Sources ({len(result.sources)})", border_style="dim")
            src_table.add_column("#", style="bold", width=3)
            src_table.add_column("Title", style="white")
            src_table.add_column("Words", style="dim", justify="right")
            for i, s in enumerate(result.sources[:10], 1):
                src_table.add_row(str(i), s.title[:70], f"{s.word_count:,}")
            console.print(src_table)

        console.print(f"\n[bold green]Report saved:[/] {result.report_path}")

    def do_research(self, topic: str):
        config = AgentConfig(
            max_pages_to_scrape=self.max_sources,
            output_dir=self.output_dir,
            depth=self.depth,
        )
        agent = DeepResearchAgent(config)
        try:
            result = agent.research(topic, depth=self.depth)
        except KeyboardInterrupt:
            console.print("\n[yellow]Cancelled.[/]")
            return
        except Exception as e:
            console.print(f"\n[red]Error: {e}[/]")
            return

        self.display_results(result)
        self.history.insert(0, (topic, result.report_path))

    def do_history(self):
        if not self.history:
            console.print("[dim]No past research yet.[/]")
            return
        table = Table(title="Research History", border_style="dim")
        table.add_column("#", style="bold cyan", width=3)
        table.add_column("Topic", style="white")
        table.add_column("Report", style="dim")
        for i, (topic, path) in enumerate(self.history[:20], 1):
            table.add_row(str(i), topic, os.path.basename(path))
        console.print(table)

    def do_read(self, index: int):
        if not self.history:
            console.print("[dim]No reports yet.[/]")
            return
        if index < 1 or index > len(self.history):
            console.print(f"[red]Invalid index. Use 1-{len(self.history)}[/]")
            return
        topic, path = self.history[index - 1]
        if not os.path.exists(path):
            console.print(f"[red]File not found: {path}[/]")
            return
        self._open_file(path)
        console.print(f"[green]Opened:[/] {path}")

    def run(self):
        console.print(BANNER)

        while True:
            try:
                user_input = console.input("[bold cyan]>[/] ").strip()
            except (EOFError, KeyboardInterrupt):
                console.print("\n[dim]Goodbye.[/]")
                break

            if not user_input:
                continue

            cmd = user_input.lower()

            if cmd in ("exit", "quit", "q"):
                console.print("[dim]Goodbye.[/]")
                break

            elif cmd == "help":
                console.print(HELP_TEXT)

            elif cmd == "clear":
                os.system("cls" if os.name == "nt" else "clear")
                console.print(BANNER)

            elif cmd == "history":
                self.do_history()

            elif cmd.startswith("depth"):
                parts = cmd.split()
                if len(parts) == 2 and parts[1] in ("1", "2", "3"):
                    self.depth = int(parts[1])
                    label = {1: "quick", 2: "medium", 3: "deep"}[self.depth]
                    console.print(f"[green]Depth set to {self.depth} ({label})[/]")
                else:
                    console.print("[red]Usage: depth <1|2|3>[/]")

            elif cmd.startswith("sources"):
                parts = cmd.split()
                if len(parts) == 2 and parts[1].isdigit() and int(parts[1]) > 0:
                    self.max_sources = int(parts[1])
                    console.print(f"[green]Max sources set to {self.max_sources}[/]")
                else:
                    console.print("[red]Usage: sources <number>[/]")

            elif cmd.startswith("read"):
                parts = cmd.split()
                if len(parts) == 2 and parts[1].isdigit():
                    self.do_read(int(parts[1]))
                else:
                    console.print("[red]Usage: read <number>[/]")

            elif cmd == "open":
                abs_path = os.path.abspath(self.output_dir)
                self._open_file(abs_path)
                console.print(f"[green]Opened reports folder:[/] {abs_path}")

            else:
                self.do_research(user_input)


def main():
    cli = ResearchCLI()

    if len(sys.argv) > 1 and not sys.argv[1].startswith("-"):
        topic = " ".join(sys.argv[1:])
        cli.do_research(topic)
        return

    cli.run()


if __name__ == "__main__":
    main()
