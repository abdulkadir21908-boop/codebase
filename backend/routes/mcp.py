"""
MCP (Model Context Protocol) HTTP endpoints for Claude Code integration.
"""

import logging
from typing import Dict, Any, List
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()


class MCPToolCall(BaseModel):
    name: str
    arguments: Dict[str, Any]


class MCPToolResult(BaseModel):
    content: List[Dict[str, Any]]
    is_error: bool = False


@router.post("/tools/call")
async def call_mcp_tool(tool_call: MCPToolCall):
    """Call an MCP tool."""
    from backend.mcp_server import mcp_tools

    tool = mcp_tools.get(tool_call.name)
    if not tool:
        raise HTTPException(404, f"Tool not found: {tool_call.name}")

    try:
        result = await tool(tool_call.arguments)
        return MCPToolResult(content=[{"type": "text", "text": str(result)}])
    except Exception as e:
        logger.error(f"MCP tool {tool_call.name} failed: {e}")
        return MCPToolResult(
            content=[{"type": "text", "text": f"Error: {str(e)}"}],
            is_error=True
        )


@router.get("/tools/list")
async def list_mcp_tools():
    """List available MCP tools."""
    from backend.mcp_server import mcp_tools

    return {
        "tools": [
            {
                "name": name,
                "description": tool.__doc__ or "No description",
                "inputSchema": getattr(tool, "input_schema", {})
            }
            for name, tool in mcp_tools.items()
        ]
    }
