# Higgsfield Local

A local-first AI image/video generation platform with optional Higgsfield API cloud integration. Designed to run on modest hardware (i3-4130T, 8GB RAM) with CPU-only inference support.

## Features

- **Local Web UI** - Higgsfield Console-inspired interface, no login required
- **CPU-Only Inference** - Optimized for low-memory systems (8GB RAM)
- **Higgsfield API Integration** - Cloud generation when local models are too heavy
- **MCP Server** - Claude Code integration for AI-assisted generation
- **Model Management** - Download, quantize, and switch models easily
- **Docker Support** - CPU-only profile for easy deployment

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 18+ (for development)
- 8GB+ RAM (swap recommended for larger models)
- Optional: NVIDIA GPU for faster inference

### Installation

```bash
# Clone and enter project
cd higgsfield-local

# Copy environment template
cp .env.example .env

# Start with Docker (recommended)
docker-compose up -d

# Or run manually
pip install -r backend/requirements.txt
python backend/main.py
```

### Access

- **Web UI**: http://localhost:7860
- **API Docs**: http://localhost:7860/docs
- **MCP Endpoint**: http://localhost:7860/mcp

## Architecture

```
higgsfield-local/
├── backend/                 # FastAPI server
│   ├── inference/          # CPU inference engines
│   ├── routes/             # API endpoints
│   └── mcp_server.py       # MCP for Claude Code
├── frontend/               # Vanilla JS web UI
├── models/                 # Model registry & storage
└── scripts/                # Utility scripts
```

## Supported Models (CPU-Optimized)

| Type | Model | Size | Quantization | Est. VRAM/RAM |
|------|-------|------|--------------|---------------|
| Image | Flux.1-schnell | 4.7B | 4-bit GGUF | ~3.5 GB |
| Image | SDXL-Turbo | 2.6B | 4-bit GGUF | ~2 GB |
| Image | SD 1.5 | 0.9B | 4-bit GGUF | ~1 GB |
| Video | CogVideoX-2b | 2B | 4-bit GGUF | ~2.5 GB |
| Video | LTX-Video | 0.9B | 4-bit GGUF | ~1.5 GB |
| Video | Wan2.1-tiny | 1.3B | 4-bit GGUF | ~1.5 GB |

## Configuration

Edit `.env` for:
- `HIGGSFIELD_API_KEY` - Cloud API key (optional)
- `DEFAULT_DEVICE` - `cpu` or `cuda`
- `MODEL_CACHE_DIR` - Model storage location
- `MAX_CONCURRENT_JOBS` - Queue concurrency

## MCP Integration (Claude Code)

Add to your Claude Code config:
```json
{
  "mcpServers": {
    "higgsfield-local": {
      "command": "python",
      "args": ["-m", "backend.mcp_server"],
      "cwd": "/path/to/higgsfield-local"
    }
  }
}
```

Available MCP tools:
- `generate_image` - Generate images locally or via API
- `generate_video` - Generate videos
- `list_models` - Show available models
- `download_model` - Download & quantize models
- `get_job_status` - Check generation progress

## Development

```bash
# Backend development
cd backend
pip install -r requirements-dev.txt
uvicorn main:app --reload --port 7860

# Frontend development (no build step)
cd frontend
python -m http.server 8080
```

## License

MIT License - See LICENSE file for details.
