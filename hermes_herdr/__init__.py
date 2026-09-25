"""Hermes plugin package for Herdr Agent Gateway."""

from __future__ import annotations

import logging
from pathlib import Path

from hermes_herdr.commands import handle_herdr_command
from hermes_herdr.tools import (
    LIST_AGENTS_SCHEMA,
    LIST_MACHINES_SCHEMA,
    MACHINE_STATUS_SCHEMA,
    PROMPT_AGENT_SCHEMA,
    READ_AGENT_SCHEMA,
    SPAWN_AGENT_SCHEMA,
    handle_herdr_list_agents,
    handle_herdr_list_machines,
    handle_herdr_node_status,
    handle_herdr_prompt_agent,
    handle_herdr_read_agent,
    handle_herdr_spawn_agent,
)

logger = logging.getLogger(__name__)


def register(ctx) -> None:
    """Register Herdr tools, skills, and slash commands into Hermes.

    Called by Hermes plugin manager upon plugin load.
    """
    # 1. Register Tools
    ctx.register_tool(
        name="herdr_spawn_agent",
        toolset="herdr",
        schema=SPAWN_AGENT_SCHEMA,
        handler=handle_herdr_spawn_agent,
        emoji="🪟",
    )
    ctx.register_tool(
        name="herdr_list_machines",
        toolset="herdr",
        schema=LIST_MACHINES_SCHEMA,
        handler=handle_herdr_list_machines,
        emoji="🖥️",
    )
    ctx.register_tool(
        name="herdr_list_agents",
        toolset="herdr",
        schema=LIST_AGENTS_SCHEMA,
        handler=handle_herdr_list_agents,
        emoji="🤖",
    )
    ctx.register_tool(
        name="herdr_prompt_agent",
        toolset="herdr",
        schema=PROMPT_AGENT_SCHEMA,
        handler=handle_herdr_prompt_agent,
        emoji="💬",
    )
    ctx.register_tool(
        name="herdr_read_agent",
        toolset="herdr",
        schema=READ_AGENT_SCHEMA,
        handler=handle_herdr_read_agent,
        emoji="📖",
    )
    ctx.register_tool(
        name="herdr_node_status",
        toolset="herdr",
        schema=MACHINE_STATUS_SCHEMA,
        handler=handle_herdr_node_status,
        emoji="🟢",
    )

    # 2. Register Bundled Skill
    skill_path = Path(__file__).resolve().parent.parent / "skills" / "spawn_herdr_agent" / "SKILL.md"
    if skill_path.exists():
        try:
            ctx.register_skill(
                name="spawn_herdr_agent",
                path=skill_path,
                description="Spawn coding agent sessions into local or remote Herdr multiplexer panes.",
            )
        except Exception as exc:
            logger.warning("Failed to register Herdr skill into Hermes: %s", exc)

    # 3. Register Slash Command
    try:
        ctx.register_command(
            "herdr",
            handle_herdr_command,
            description="Manage and inspect multi-machine Herdr workspaces and agents.",
        )
    except Exception as exc:
        logger.warning("Failed to register /herdr command into Hermes: %s", exc)
