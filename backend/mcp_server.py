"""
MCP Server for Claude Code integration.
Exposes Higgsfield Local functionality as MCP tools.
"""

import asyncio
import json
import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

# Global references (set by main.py)
model_manager = None
cpu_engine = None
api_client = None

# MCP Tools registry
mcp_tools: Dict[str, Any] = {}


def mcp_tool(name: str, description: str = "", input_schema: dict = None):
    """Decorator to register an MCP tool."""
    def decorator(func):
        func.input_schema = input_schema or {
            "type": "object",
            "properties": {},
            "required": []
        }
        mcp_tools[name] = func
        return func
    return decorator


# ===== Tool Definitions =====

@mcp_tool(
    "generate_image",
    "Generate an image using local or cloud inference",
    {
        "type": "object",
        "properties": {
            "prompt": {"type": "string", "description": "Text prompt for generation"},
            "negative_prompt": {"type": "string", "description": "Negative prompt", "default": ""},
            "model_id": {"type": "string", "description": "Model ID to use (optional, uses default)"},
            "width": {"type": "integer", "default": 512, "minimum": 64, "maximum": 2048},
            "height": {"type": "integer", "default": 512, "minimum": 64, "maximum": 2048},
            "steps": {"type": "integer", "default": 20, "minimum": 1, "maximum": 100},
            "guidance_scale": {"type": "number", "default": 7.5, "minimum": 0, "maximum": 20},
            "seed": {"type": "integer", "minimum": 0, "maximum": 4294967295},
            "backend": {"type": "string", "enum": ["local", "cloud", "auto"], "default": "auto"}
        },
        "required": ["prompt"]
    }
)
async def generate_image(args: dict) -> str:
    """Generate an image."""
    if not cpu_engine:
        return "Error: Local inference not available. Install torch: pip install torch"

    try:
        from backend.inference.cpu_engine import GenerationRequest, ModelType
    except (ImportError, OSError) as e:
        return f"Error: {e}"

    request = GenerationRequest(
        prompt=args["prompt"],
        negative_prompt=args.get("negative_prompt", ""),
        model_id=args.get("model_id", ""),
        model_type=ModelType.IMAGE,
        width=args.get("width", 512),
        height=args.get("height", 512),
        num_inference_steps=args.get("steps", 20),
        guidance_scale=args.get("guidance_scale", 7.5),
        seed=args.get("seed"),
        quantization=args.get("quantization", "q4_k_m")
    )

    if model_manager:
        model_info = model_manager.get_model(request.model_id) if request.model_id else model_manager.get_default_model()
        if model_info and model_info.downloaded:
            result = await cpu_engine.generate(request)
            return f"Generated image: {result.output_paths[0]} (took {result.generation_time:.1f}s)"

    return "Error: No available backend for generation"


@mcp_tool(
    "generate_video",
    "Generate a video using local or cloud inference",
    {
        "type": "object",
        "properties": {
            "prompt": {"type": "string", "description": "Text prompt for generation"},
            "negative_prompt": {"type": "string", "description": "Negative prompt", "default": ""},
            "model_id": {"type": "string", "description": "Model ID to use (optional)"},
            "width": {"type": "integer", "default": 512, "minimum": 64, "maximum": 1024},
            "height": {"type": "integer", "default": 512, "minimum": 64, "maximum": 1024},
            "num_frames": {"type": "integer", "default": 16, "minimum": 1, "maximum": 128},
            "fps": {"type": "integer", "default": 8, "minimum": 1, "maximum": 30},
            "steps": {"type": "integer", "default": 20, "minimum": 1, "maximum": 100},
            "guidance_scale": {"type": "number", "default": 7.5, "minimum": 0, "maximum": 20},
            "seed": {"type": "integer", "minimum": 0, "maximum": 4294967295},
            "backend": {"type": "string", "enum": ["local", "cloud", "auto"], "default": "auto"}
        },
        "required": ["prompt"]
    }
)
async def generate_video(args: dict) -> str:
    """Generate a video."""
    if not cpu_engine:
        return "Error: Local inference not available. Install torch: pip install torch"

    try:
        from backend.inference.cpu_engine import GenerationRequest, ModelType
    except (ImportError, OSError) as e:
        return f"Error: {e}"

    request = GenerationRequest(
        prompt=args["prompt"],
        negative_prompt=args.get("negative_prompt", ""),
        model_id=args.get("model_id", ""),
        model_type=ModelType.VIDEO,
        width=args.get("width", 512),
        height=args.get("height", 512),
        num_frames=args.get("num_frames", 16),
        fps=args.get("fps", 8),
        num_inference_steps=args.get("steps", 20),
        guidance_scale=args.get("guidance_scale", 7.5),
        seed=args.get("seed"),
        quantization=args.get("quantization", "q4_k_m")
    )

    if model_manager:
        model_info = model_manager.get_model(request.model_id) if request.model_id else None
        if not model_info:
            video_models = model_manager.get_models_by_type(ModelType.VIDEO)
            if video_models:
                model_info = video_models[0]
                request.model_id = model_info.model_id

        if model_info and model_info.downloaded:
            result = await cpu_engine.generate(request)
            return f"Generated video: {result.output_paths[0]} (took {result.generation_time:.1f}s)"

    return "Video generation requires a downloaded model or API key"


@mcp_tool(
    "list_models",
    "List all available models",
    {
        "type": "object",
        "properties": {
            "type": {"type": "string", "enum": ["image", "video", "all"], "default": "all"},
            "downloaded_only": {"type": "boolean", "default": False}
        }
    }
)
async def list_models(args: dict) -> str:
    """List available models."""
    if not model_manager:
        return "Model manager not initialized"

    model_type = args.get("type", "all")
    downloaded_only = args.get("downloaded_only", False)

    if model_type != "all":
        from backend.inference.model_manager import ModelType
        models = model_manager.get_models_by_type(ModelType(model_type))
    else:
        models = model_manager.get_all_models()

    if downloaded_only:
        models = [m for m in models if m.downloaded]

    lines = []
    for m in models:
        status = "[OK]" if m.downloaded else "[  ]"
        quant = f" ({m.quantization.value})" if m.quantized else ""
        default = " *" if m.is_default else ""
        lines.append(f"{status} {m.model_id}: {m.name}{quant}{default}")
        lines.append(f"   Type: {m.type.value}, Backend: {m.backend.value}, Size: {m.size_gb}GB")
        lines.append(f"   RAM: {m.min_ram_gb}GB min / {m.recommended_ram_gb}GB recommended")
        lines.append(f"   {m.description}")
        lines.append("")

    return "\n".join(lines) if lines else "No models found"


@mcp_tool(
    "download_model",
    "Download and optionally quantize a model",
    {
        "type": "object",
        "properties": {
            "model_id": {"type": "string", "description": "Model ID to download"},
            "quantization": {"type": "string", "enum": ["none", "q4_k_m", "q4_k_s", "q5_k_m", "q8_0"], "default": "q4_k_m"}
        },
        "required": ["model_id"]
    }
)
async def download_model(args: dict) -> str:
    """Download a model."""
    if not model_manager:
        return "Model manager not initialized"

    model_id = args["model_id"]
    quant_str = args.get("quantization", "q4_k_m")

    from backend.inference.model_manager import QuantizationType
    quantization = QuantizationType.NONE if quant_str == "none" else QuantizationType(quant_str)

    success = await model_manager.download_model(model_id, quantization)

    if success:
        model = model_manager.get_model(model_id)
        return f"Downloaded {model.name} ({model.size_gb}GB)"
    else:
        return f"Failed to download {model_id}"


@mcp_tool(
    "get_job_status",
    "Check status of a generation job",
    {
        "type": "object",
        "properties": {
            "job_id": {"type": "string", "description": "Job ID to check"}
        },
        "required": ["job_id"]
    }
)
async def get_job_status(args: dict) -> str:
    """Get job status."""
    from backend.routes.generate import job_queue, job_results

    job_id = args["job_id"]
    if job_id not in job_queue:
        return f"Job {job_id} not found"

    job = job_queue[job_id]
    status = job["status"]
    progress = job.get("progress", 0) * 100

    result = f"Job {job_id}: {status} ({progress:.0f}%)\n"
    result += f"Type: {job['type']}\n"
    result += f"Model: {job['model_id']}\n"

    if status == "completed" and job_id in job_results:
        res = job_results[job_id]
        result += f"Output: {res['output_paths']}\n"
        result += f"Time: {res['generation_time']:.1f}s"
    elif status == "failed":
        result += f"Error: {job.get('error', 'Unknown error')}"

    return result


# ===== MCP Server Setup =====

def create_mcp_server():
    """Create the MCP server instance."""
    try:
        from mcp.server import Server
        from mcp.types import Tool, TextContent
    except ImportError:
        logger.warning("MCP not available. Install: pip install mcp")
        return None

    server = Server("higgsfield-local")

    @server.list_tools()
    async def list_tools():
        from mcp.types import Tool
        return [
            Tool(
                name=name,
                description=tool.__doc__ or "",
                inputSchema=tool.input_schema
            )
            for name, tool in mcp_tools.items()
        ]

    @server.call_tool()
    async def call_tool(name: str, arguments: dict):
        from mcp.types import TextContent
        if name not in mcp_tools:
            raise ValueError(f"Unknown tool: {name}")

        try:
            result = await mcp_tools[name](arguments)
            return [TextContent(type="text", text=str(result))]
        except Exception as e:
            logger.error(f"MCP tool {name} failed: {e}")
            return [TextContent(type="text", text=f"Error: {str(e)}")]

    return server


# Create the MCP app for mounting
mcp_server = create_mcp_server()

# Create ASGI app for FastAPI mounting
if mcp_server:
    try:
        from mcp.server.sse import SseServerTransport
        from starlette.applications import Starlette
        from starlette.routing import Mount, Route

        sse = SseServerTransport("/mcp/messages")

        async def handle_sse(request):
            async with sse.connect_sse(
                request.scope, request.receive, request._send
            ) as streams:
                await mcp_server.run(
                    streams[0], streams[1], mcp_server.create_initialization_options()
                )

        mcp_app = Starlette(
            routes=[
                Route("/sse", handle_sse),
                Mount("/messages", app=sse.handle_post_message),
            ]
        )
    except ImportError:
        mcp_app = None
else:
    mcp_app = None
