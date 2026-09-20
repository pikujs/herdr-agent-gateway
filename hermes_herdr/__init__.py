"""Hermes plugin package for Herdr Agent Gateway."""

from __future__ import annotations

import logging
from pathlib import Path

from hermes_herdr.commands import handle_herdr_command
from hermes_herdr.tools import (
    LIST_NODES_SCHEMA,
    NODE_STATUS_SCHEMA,
    SPAWN_AGENT_SCHEMA,
    handle_herdr_list_nodes,
    handle_herdr_node_status,
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
        name="herdr_list_nodes",
        toolset="herdr",
        schema=LIST_NODES_SCHEMA,
        handler=handle_herdr_list_nodes,
        emoji="📋",
    )
    ctx.register_tool(
        name="herdr_node_status",
        toolset="herdr",
        schema=NODE_STATUS_SCHEMA,
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
            handler=handle_herdr_command,
            description="Control Herdr terminal multiplexer and spawn agent sessions.",
        )
    except Exception as exc:
        logger.warning("Failed to register /herdr command into Hermes: %s", exc)
