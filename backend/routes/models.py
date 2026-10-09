"""
Model management API routes.
"""

import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, Query
from pydantic import BaseModel

from backend.inference.model_manager import ModelManager, ModelInfo, ModelType, QuantizationType

logger = logging.getLogger(__name__)

router = APIRouter()


def get_model_manager():
    from backend.main import model_manager
    if model_manager is None:
        raise HTTPException(503, "Model manager not initialized")
    return model_manager


class ModelResponse(BaseModel):
    model_id: str
    name: str
    type: str
    backend: str
    quantization: str
    size_gb: float
    min_ram_gb: float
    recommended_ram_gb: float
    description: str
    tags: List[str]
    is_default: bool
    downloaded: bool
    quantized: bool


class DownloadRequest(BaseModel):
    model_id: str
    quantization: Optional[str] = "q4_k_m"
    force: bool = False


@router.get("/models", response_model=List[ModelResponse])
async def list_models(
    type: Optional[ModelType] = Query(None),
    downloaded_only: bool = Query(False),
    model_manager: ModelManager = Depends(get_model_manager)
):
    """List all available models."""
    models = model_manager.get_all_models()

    if type:
        models = [m for m in models if m.type == type]

    if downloaded_only:
        models = [m for m in models if m.downloaded]

    return [
        ModelResponse(
            model_id=m.model_id,
            name=m.name,
            type=m.type.value,
            backend=m.backend.value,
            quantization=m.quantization.value,
            size_gb=m.size_gb,
            min_ram_gb=m.min_ram_gb,
            recommended_ram_gb=m.recommended_ram_gb,
            description=m.description,
            tags=m.tags,
            is_default=m.is_default,
            downloaded=m.downloaded,
            quantized=m.quantized
        )
        for m in models
    ]


@router.get("/models/{model_id}", response_model=ModelResponse)
async def get_model(
    model_id: str,
    model_manager: ModelManager = Depends(get_model_manager)
):
    """Get detailed model information."""
    model = model_manager.get_model(model_id)
    if not model:
        raise HTTPException(404, "Model not found")

    return ModelResponse(
        model_id=model.model_id,
        name=model.name,
        type=model.type.value,
        backend=model.backend.value,
        quantization=model.quantization.value,
        size_gb=model.size_gb,
        min_ram_gb=model.min_ram_gb,
        recommended_ram_gb=model.recommended_ram_gb,
        description=model.description,
        tags=model.tags,
        is_default=model.is_default,
        downloaded=model.downloaded,
        quantized=model.quantized
    )


@router.post("/models/download")
async def download_model(
    request: DownloadRequest,
    background_tasks: BackgroundTasks,
    model_manager: ModelManager = Depends(get_model_manager)
):
    """Download a model (with optional quantization)."""
    model = model_manager.get_model(request.model_id)
    if not model:
        raise HTTPException(404, "Model not found")

    if model.downloaded and not request.force:
        return {"message": "Model already downloaded", "model_id": request.model_id}

    # Parse quantization
    quant = QuantizationType.NONE
    if request.quantization:
        try:
            quant = QuantizationType(request.quantization)
        except ValueError:
            raise HTTPException(400, f"Invalid quantization: {request.quantization}")

    # Start download in background
    background_tasks.add_task(
        _download_model_task,
        model_manager,
        request.model_id,
        quant,
        request.force
    )

    return {"message": "Download started", "model_id": request.model_id}


async def _download_model_task(
    model_manager: ModelManager,
    model_id: str,
    quantization: QuantizationType,
    force: bool
):
    """Background task for model download."""
    await model_manager.download_model(model_id, quantization, force)


@router.post("/models/{model_id}/quantize")
async def quantize_model(
    model_id: str,
    quantization: str = "q4_k_m",
    model_manager: ModelManager = Depends(get_model_manager)
):
    """Quantize a downloaded model."""
    model = model_manager.get_model(model_id)
    if not model:
        raise HTTPException(404, "Model not found")

    if not model.downloaded:
        raise HTTPException(400, "Model must be downloaded first")

    try:
        quant = QuantizationType(quantization)
    except ValueError:
        raise HTTPException(400, f"Invalid quantization: {quantization}")

    success = await model_manager.quantize_model(model_id, quant)
    if success:
        return {"message": "Quantization complete", "model_id": model_id}
    else:
        raise HTTPException(500, "Quantization failed")


@router.delete("/models/{model_id}")
async def delete_model(
    model_id: str,
    model_manager: ModelManager = Depends(get_model_manager)
):
    """Delete a downloaded model."""
    model = model_manager.get_model(model_id)
    if not model:
        raise HTTPException(404, "Model not found")

    if not model.downloaded:
        raise HTTPException(400, "Model not downloaded")

    success = model_manager.delete_model(model_id)
    if success:
        return {"message": "Model deleted", "model_id": model_id}
    else:
        raise HTTPException(500, "Deletion failed")


@router.get("/models/disk/usage")
async def get_disk_usage(model_manager: ModelManager = Depends(get_model_manager)):
    """Get disk usage for models."""
    return model_manager.get_disk_usage()
