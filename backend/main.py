"""
Higgsfield Local - FastAPI Application Entry Point
Local-first AI image/video generation with Higgsfield API integration.
"""

import os
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from backend.config import settings

# Global instances
model_manager = None
cpu_engine = None
api_client = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager for startup/shutdown."""
    global model_manager, cpu_engine, api_client

    # Startup
    print("Starting Higgsfield Local...")

    # Initialize model manager (no torch needed)
    from backend.inference.model_manager import ModelManager
    model_manager = ModelManager(
        cache_dir=settings.MODEL_CACHE_DIR,
        registry_path=settings.MODEL_REGISTRY_PATH
    )
    await model_manager.initialize()

    # Try to initialize CPU inference engine (requires torch)
    try:
        from backend.inference.cpu_engine import CPUInferenceEngine
        cpu_engine = CPUInferenceEngine(
            model_manager=model_manager,
            device=settings.DEFAULT_DEVICE,
            torch_compile=settings.ENABLE_TORCH_COMPILE,
            channels_last=settings.ENABLE_CHANNELS_LAST
        )
        await cpu_engine.initialize()
        print("CPU inference engine ready")
    except ImportError as e:
        print(f"Warning: CPU inference engine not available: {e}")
        print("Install torch for local generation: pip install torch")
        cpu_engine = None

    # Initialize API client (optional)
    if settings.HIGGSFIELD_API_KEY:
        try:
            from backend.inference.api_client import HiggsfieldAPIClient
            api_client = HiggsfieldAPIClient(
                api_key=settings.HIGGSFIELD_API_KEY,
                base_url=settings.HIGGSFIELD_API_URL
            )
            print("Higgsfield API client initialized")
        except ImportError as e:
            print(f"Warning: API client not available: {e}")
            api_client = None
    else:
        print("No Higgsfield API key - cloud generation disabled")

    # Store in app state
    app.state.model_manager = model_manager
    app.state.cpu_engine = cpu_engine
    app.state.api_client = api_client

    print("Higgsfield Local ready!")
    yield

    # Shutdown
    print("Shutting down...")
    if cpu_engine:
        await cpu_engine.cleanup()
    print("Shutdown complete")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="Higgsfield Local",
        description="Local-first AI image/video generation platform",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc"
    )

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include routers
    from backend.routes import generate, models, status, mcp
    app.include_router(generate.router, prefix="/api/v1", tags=["generation"])
    app.include_router(models.router, prefix="/api/v1", tags=["models"])
    app.include_router(status.router, prefix="/api/v1", tags=["status"])
    app.include_router(mcp.router, prefix="/api/v1", tags=["mcp"])

    # Mount MCP server as sub-application (if available)
    try:
        from backend.mcp_server import mcp_app
        if mcp_app:
            app.mount("/mcp", mcp_app)
    except Exception as e:
        print(f"Warning: MCP server not available: {e}")

    # Serve frontend
    frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
    if os.path.exists(frontend_path):
        app.mount("/static", StaticFiles(directory=frontend_path), name="static")

        @app.get("/", response_class=HTMLResponse)
        async def serve_ui():
            return FileResponse(os.path.join(frontend_path, "index.html"))

    # Health check
    @app.get("/health")
    async def health_check():
        return {
            "status": "healthy",
            "version": "1.0.0",
            "device": settings.DEFAULT_DEVICE,
            "models_loaded": len(model_manager.models) if model_manager else 0
        }

    # System info
    @app.get("/api/v1/system/info")
    async def system_info():
        import psutil
        return {
            "cpu_count": psutil.cpu_count(),
            "memory_total_gb": round(psutil.virtual_memory().total / (1024**3), 1),
            "memory_available_gb": round(psutil.virtual_memory().available / (1024**3), 1),
            "device": settings.DEFAULT_DEVICE,
            "torch_available": False,
            "torch_compile": settings.ENABLE_TORCH_COMPILE,
            "channels_last": settings.ENABLE_CHANNELS_LAST
        }

    return app


app = create_app()


if __name__ == "__main__":
    uvicorn.run(
        "backend.main:app",
        host=settings.HOST,
        port=settings.PORT,
        workers=settings.WORKERS,
        reload=os.getenv("DEV_MODE", "false").lower() == "true"
    )
