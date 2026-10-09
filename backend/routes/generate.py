"""
Generation API routes for images and videos.
"""

import asyncio
import logging
from typing import Optional, List
from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from pydantic import BaseModel, Field
from enum import Enum

logger = logging.getLogger(__name__)

router = APIRouter()


class ModelType(str, Enum):
    IMAGE = "image"
    VIDEO = "video"


class GenerationBackend(str, Enum):
    LOCAL = "local"
    CLOUD = "cloud"
    AUTO = "auto"


class ImageGenerationRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000)
    negative_prompt: str = Field(default="", max_length=2000)
    model_id: str = Field(default="")
    width: int = Field(default=512, ge=64, le=2048)
    height: int = Field(default=512, ge=64, le=2048)
    num_inference_steps: int = Field(default=20, ge=1, le=100)
    guidance_scale: float = Field(default=7.5, ge=0.0, le=20.0)
    seed: Optional[int] = Field(default=None, ge=0, le=2**32-1)
    backend: GenerationBackend = Field(default=GenerationBackend.AUTO)
    quantization: str = Field(default="q4_k_m")


class VideoGenerationRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000)
    negative_prompt: str = Field(default="", max_length=2000)
    model_id: str = Field(default="")
    width: int = Field(default=512, ge=64, le=1024)
    height: int = Field(default=512, ge=64, le=1024)
    num_frames: int = Field(default=16, ge=1, le=128)
    fps: int = Field(default=8, ge=1, le=30)
    num_inference_steps: int = Field(default=20, ge=1, le=100)
    guidance_scale: float = Field(default=7.5, ge=0.0, le=20.0)
    seed: Optional[int] = Field(default=None, ge=0, le=2**32-1)
    backend: GenerationBackend = Field(default=GenerationBackend.AUTO)
    quantization: str = Field(default="q4_k_m")


class GenerationResponse(BaseModel):
    job_id: str
    status: str
    message: str


# In-memory job queue (replace with Redis in production)
job_queue: dict = {}
job_results: dict = {}


async def get_cpu_engine():
    from backend.main import cpu_engine
    if cpu_engine is None:
        raise HTTPException(503, "Inference engine not initialized. Install torch: pip install torch")
    return cpu_engine


async def get_api_client():
    from backend.main import api_client
    return api_client


async def get_model_manager():
    from backend.main import model_manager
    if model_manager is None:
        raise HTTPException(503, "Model manager not initialized")
    return model_manager


@router.post("/generate/image", response_model=GenerationResponse)
async def generate_image(
    request: ImageGenerationRequest,
    background_tasks: BackgroundTasks,
    model_manager=Depends(get_model_manager)
):
    from backend.main import cpu_engine, api_client
    """Generate an image using local or cloud inference."""

    # Determine model
    model_id = request.model_id
    if not model_id:
        default_model = model_manager.get_default_model()
        if not default_model:
            raise HTTPException(400, "No models available")
        model_id = default_model.model_id

    # Validate model exists
    model_info = model_manager.get_model(model_id)
    if not model_info:
        raise HTTPException(404, f"Model {model_id} not found")

    if model_info.type != ModelType.IMAGE:
        raise HTTPException(400, f"Model {model_id} is not an image model")

    # Check if model is downloaded for local generation
    use_local = request.backend in (GenerationBackend.LOCAL, GenerationBackend.AUTO)
    can_use_local = use_local and model_info.downloaded and cpu_engine is not None

    # Generate job ID
    import uuid
    job_id = str(uuid.uuid4())[:12]

    # Create job record
    job_queue[job_id] = {
        "id": job_id,
        "type": "image",
        "status": "pending",
        "request": request.model_dump(),
        "model_id": model_id,
        "progress": 0.0
    }

    # Start generation in background
    background_tasks.add_task(
        _process_generation_job,
        job_id,
        request,
        model_info,
        can_use_local,
        cpu_engine,
        api_client
    )

    return GenerationResponse(
        job_id=job_id,
        status="pending",
        message="Generation started"
    )


@router.post("/generate/video", response_model=GenerationResponse)
async def generate_video(
    request: VideoGenerationRequest,
    background_tasks: BackgroundTasks,
    model_manager=Depends(get_model_manager)
):
    from backend.main import cpu_engine, api_client
    """Generate a video using local or cloud inference."""

    model_id = request.model_id
    if not model_id:
        # Find default video model
        video_models = model_manager.get_models_by_type(ModelType.VIDEO)
        if not video_models:
            raise HTTPException(400, "No video models available")
        model_id = video_models[0].model_id

    model_info = model_manager.get_model(model_id)
    if not model_info:
        raise HTTPException(404, f"Model {model_id} not found")

    if model_info.type != ModelType.VIDEO:
        raise HTTPException(400, f"Model {model_id} is not a video model")

    use_local = request.backend in (GenerationBackend.LOCAL, GenerationBackend.AUTO)
    can_use_local = use_local and model_info.downloaded and cpu_engine is not None

    import uuid
    job_id = str(uuid.uuid4())[:12]

    job_queue[job_id] = {
        "id": job_id,
        "type": "video",
        "status": "pending",
        "request": request.model_dump(),
        "model_id": model_id,
        "progress": 0.0
    }

    background_tasks.add_task(
        _process_generation_job,
        job_id,
        request,
        model_info,
        can_use_local,
        cpu_engine,
        api_client
    )

    return GenerationResponse(
        job_id=job_id,
        status="pending",
        message="Generation started"
    )


async def _process_generation_job(
    job_id: str,
    request: BaseModel,
    model_info,
    can_use_local: bool,
    cpu_engine,
    api_client
):
    """Background task to process generation job."""
    job_queue[job_id]["status"] = "processing"
    job_queue[job_id]["progress"] = 0.1

    try:
        if can_use_local and cpu_engine:
            # Local generation
            try:
                from backend.inference.cpu_engine import GenerationRequest, ModelType
            except (ImportError, OSError) as e:
                raise Exception(f"Local inference not available: {e}. Install torch: pip install torch")

            gen_request = GenerationRequest(
                prompt=request.prompt,
                negative_prompt=request.negative_prompt,
                model_id=model_info.model_id,
                model_type=ModelType.IMAGE if hasattr(request, 'width') and not hasattr(request, 'num_frames') else ModelType.VIDEO,
                width=request.width,
                height=request.height,
                num_inference_steps=request.num_inference_steps,
                guidance_scale=request.guidance_scale,
                seed=request.seed,
                quantization=request.quantization
            )

            if hasattr(request, 'num_frames'):
                gen_request.num_frames = request.num_frames
                gen_request.fps = request.fps

            job_queue[job_id]["progress"] = 0.3
            result = await cpu_engine.generate(gen_request)
            job_queue[job_id]["progress"] = 0.9

            job_results[job_id] = {
                "output_paths": result.output_paths,
                "metadata": result.metadata,
                "generation_time": result.generation_time
            }

        elif api_client:
            # Cloud generation fallback
            job_queue[job_id]["progress"] = 0.2

            if hasattr(request, 'num_frames'):
                # Video
                cloud_job = await api_client.generate_video(
                    prompt=request.prompt,
                    model_id=model_info.hf_repo_id,
                    negative_prompt=request.negative_prompt,
                    width=request.width,
                    height=request.height,
                    num_frames=request.num_frames,
                    fps=request.fps,
                    steps=request.num_inference_steps,
                    guidance_scale=request.guidance_scale,
                    seed=request.seed
                )
            else:
                # Image
                cloud_job = await api_client.generate_image(
                    prompt=request.prompt,
                    model_id=model_info.hf_repo_id,
                    negative_prompt=request.negative_prompt,
                    width=request.width,
                    height=request.height,
                    steps=request.num_inference_steps,
                    guidance_scale=request.guidance_scale,
                    seed=request.seed
                )

            job_queue[job_id]["progress"] = 0.5
            cloud_job = await api_client.wait_for_completion(cloud_job.job_id)
            job_queue[job_id]["progress"] = 0.8

            if cloud_job.status == "completed":
                output_dir = Path("outputs") / ("video" if hasattr(request, 'num_frames') else "image")
                downloaded = await api_client.download_results(cloud_job, output_dir)
                job_results[job_id] = {
                    "output_paths": [str(p) for p in downloaded],
                    "metadata": {"cloud": True, "job_id": cloud_job.job_id},
                    "generation_time": 0
                }
            else:
                raise Exception(cloud_job.error or "Cloud generation failed")
        else:
            raise Exception("No local model available (install torch) and no API key configured")

        job_queue[job_id]["status"] = "completed"
        job_queue[job_id]["progress"] = 1.0

    except Exception as e:
        logger.error(f"Generation job {job_id} failed: {e}")
        job_queue[job_id]["status"] = "failed"
        job_queue[job_id]["error"] = str(e)
        job_queue[job_id]["progress"] = 1.0


@router.get("/jobs/{job_id}")
async def get_job_status(job_id: str):
    """Get generation job status."""
    if job_id not in job_queue:
        raise HTTPException(404, "Job not found")

    job = job_queue[job_id].copy()

    if job["status"] == "completed" and job_id in job_results:
        job["result"] = job_results[job_id]

    return job


@router.get("/jobs")
async def list_jobs(limit: int = 50, offset: int = 0):
    """List recent generation jobs."""
    jobs = list(job_queue.values())
    jobs.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return jobs[offset:offset+limit]
