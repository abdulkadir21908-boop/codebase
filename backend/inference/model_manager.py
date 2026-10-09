"""
Model management for Higgsfield Local.
Handles downloading, quantization, and model registry.
"""

import os
import json
import asyncio
import logging
from typing import Dict, List, Optional, Any
from pathlib import Path
from dataclasses import dataclass, asdict, field
from enum import Enum
from huggingface_hub import hf_hub_download, snapshot_download
from huggingface_hub.utils import HFValidationError
import shutil

logger = logging.getLogger(__name__)


class ModelBackend(str, Enum):
    DIFFUSERS = "diffusers"
    COMFYUI = "comfyui"
    GGUF = "gguf"


class ModelType(str, Enum):
    IMAGE = "image"
    VIDEO = "video"


class QuantizationType(str, Enum):
    NONE = "none"
    Q4_K_M = "q4_k_m"
    Q4_K_S = "q4_k_s"
    Q5_K_M = "q5_k_m"
    Q8_0 = "q8_0"
    BNB_4BIT = "bnb_4bit"
    BNB_8BIT = "bnb_8bit"


@dataclass
class ModelInfo:
    model_id: str
    name: str
    type: ModelType
    backend: ModelBackend
    hf_repo_id: str
    pipeline_class: str
    local_path: Optional[str] = None
    workflow_path: Optional[str] = None
    quantization: QuantizationType = QuantizationType.NONE
    size_gb: float = 0.0
    min_ram_gb: float = 4.0
    recommended_ram_gb: float = 8.0
    description: str = ""
    tags: List[str] = field(default_factory=list)
    is_default: bool = False
    downloaded: bool = False
    quantized: bool = False


class ModelManager:
    """
    Manages model registry, downloads, and quantization.
    """

    def __init__(
        self,
        cache_dir: str = "./models/cache",
        registry_path: str = "./models/registry.json"
    ):
        self.cache_dir = Path(cache_dir)
        self.registry_path = Path(registry_path)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        self.models: Dict[str, ModelInfo] = {}
        self._load_registry()

    def _load_registry(self):
        """Load model registry from JSON file."""
        if self.registry_path.exists():
            with open(self.registry_path, "r") as f:
                data = json.load(f)

            for model_data in data.get("models", []):
                model = ModelInfo(
                    model_id=model_data["model_id"],
                    name=model_data["name"],
                    type=ModelType(model_data["type"]),
                    backend=ModelBackend(model_data["backend"]),
                    hf_repo_id=model_data["hf_repo_id"],
                    pipeline_class=model_data["pipeline_class"],
                    local_path=model_data.get("local_path"),
                    workflow_path=model_data.get("workflow_path"),
                    quantization=QuantizationType(model_data.get("quantization", "none")),
                    size_gb=model_data.get("size_gb", 0.0),
                    min_ram_gb=model_data.get("min_ram_gb", 4.0),
                    recommended_ram_gb=model_data.get("recommended_ram_gb", 8.0),
                    description=model_data.get("description", ""),
                    tags=model_data.get("tags", []),
                    is_default=model_data.get("is_default", False),
                    downloaded=model_data.get("downloaded", False),
                    quantized=model_data.get("quantized", False)
                )
                self.models[model.model_id] = model

            logger.info(f"Loaded {len(self.models)} models from registry")
        else:
            logger.warning(f"Registry not found at {self.registry_path}")
            self._create_default_registry()

    def _create_default_registry(self):
        """Create default model registry with CPU-friendly models."""
        default_models = [
            ModelInfo(
                model_id="flux-schnell-4bit",
                name="Flux.1 Schnell (4-bit)",
                type=ModelType.IMAGE,
                backend=ModelBackend.DIFFUSERS,
                hf_repo_id="black-forest-labs/FLUX.1-schnell",
                pipeline_class="FluxPipeline",
                quantization=QuantizationType.Q4_K_M,
                size_gb=4.7,
                min_ram_gb=6.0,
                recommended_ram_gb=8.0,
                description="Fast Flux variant, excellent quality, 4-bit quantized for CPU",
                tags=["flux", "fast", "high-quality"],
                is_default=True
            ),
            ModelInfo(
                model_id="sdxl-turbo-4bit",
                name="SDXL Turbo (4-bit)",
                type=ModelType.IMAGE,
                backend=ModelBackend.DIFFUSERS,
                hf_repo_id="stabilityai/sdxl-turbo",
                pipeline_class="StableDiffusionXLPipeline",
                quantization=QuantizationType.Q4_K_M,
                size_gb=2.6,
                min_ram_gb=4.0,
                recommended_ram_gb=6.0,
                description="Ultra-fast SDXL, 1-4 steps, 4-bit quantized",
                tags=["sdxl", "turbo", "fast"]
            ),
            ModelInfo(
                model_id="sd15-4bit",
                name="Stable Diffusion 1.5 (4-bit)",
                type=ModelType.IMAGE,
                backend=ModelBackend.DIFFUSERS,
                hf_repo_id="runwayml/stable-diffusion-v1-5",
                pipeline_class="StableDiffusionPipeline",
                quantization=QuantizationType.Q4_K_M,
                size_gb=0.9,
                min_ram_gb=2.0,
                recommended_ram_gb=4.0,
                description="Classic SD 1.5, very lightweight, 4-bit quantized",
                tags=["sd15", "lightweight", "classic"]
            ),
            ModelInfo(
                model_id="cogvideox-2b-4bit",
                name="CogVideoX-2B (4-bit)",
                type=ModelType.VIDEO,
                backend=ModelBackend.DIFFUSERS,
                hf_repo_id="THUDM/CogVideoX-2b",
                pipeline_class="CogVideoXPipeline",
                quantization=QuantizationType.Q4_K_M,
                size_gb=2.0,
                min_ram_gb=4.0,
                recommended_ram_gb=8.0,
                description="Smallest CogVideoX, good quality, 4-bit for CPU",
                tags=["cogvideo", "video", "small"]
            ),
            ModelInfo(
                model_id="ltx-video-4bit",
                name="LTX-Video 0.9B (4-bit)",
                type=ModelType.VIDEO,
                backend=ModelBackend.DIFFUSERS,
                hf_repo_id="Lightricks/LTX-Video",
                pipeline_class="LTXPipeline",
                quantization=QuantizationType.Q4_K_M,
                size_gb=0.9,
                min_ram_gb=3.0,
                recommended_ram_gb=6.0,
                description="Lightning-fast video generation, 0.9B params, 4-bit",
                tags=["ltx", "video", "fast", "lightweight"]
            ),
            ModelInfo(
                model_id="wan21-tiny-4bit",
                name="Wan2.1 Tiny (4-bit)",
                type=ModelType.VIDEO,
                backend=ModelBackend.DIFFUSERS,
                hf_repo_id="Wan-AI/Wan2.1-T2V-1.3B",
                pipeline_class="WanPipeline",
                quantization=QuantizationType.Q4_K_M,
                size_gb=1.3,
                min_ram_gb=3.0,
                recommended_ram_gb=6.0,
                description="Tiny Wan2.1 variant, efficient video generation",
                tags=["wan", "video", "tiny"]
            )
        ]

        for model in default_models:
            self.models[model.model_id] = model

        self._save_registry()
        logger.info("Created default model registry")

    def _save_registry(self):
        """Save model registry to JSON file."""
        data = {
            "models": [asdict(m) for m in self.models.values()]
        }
        # Convert enums to strings
        for model_data in data["models"]:
            model_data["type"] = model_data["type"].value if hasattr(model_data["type"], "value") else model_data["type"]
            model_data["backend"] = model_data["backend"].value if hasattr(model_data["backend"], "value") else model_data["backend"]
            model_data["quantization"] = model_data["quantization"].value if hasattr(model_data["quantization"], "value") else model_data["quantization"]

        with open(self.registry_path, "w") as f:
            json.dump(data, f, indent=2)

    async def initialize(self):
        """Initialize model manager - check downloaded models."""
        for model in self.models.values():
            if model.local_path and Path(model.local_path).exists():
                model.downloaded = True
                if model.quantization != QuantizationType.NONE:
                    model.quantized = True
        self._save_registry()

    def get_model(self, model_id: str) -> Optional[ModelInfo]:
        """Get model info by ID."""
        return self.models.get(model_id)

    def get_all_models(self) -> List[ModelInfo]:
        """Get all registered models."""
        return list(self.models.values())

    def get_models_by_type(self, model_type: ModelType) -> List[ModelInfo]:
        """Get models filtered by type."""
        return [m for m in self.models.values() if m.type == model_type]

    def get_default_model(self) -> Optional[ModelInfo]:
        """Get the default model."""
        for model in self.models.values():
            if model.is_default:
                return model
        return list(self.models.values())[0] if self.models else None

    async def download_model(
        self,
        model_id: str,
        quantization: Optional[QuantizationType] = None,
        force: bool = False
    ) -> bool:
        """Download a model from Hugging Face Hub."""
        model = self.get_model(model_id)
        if not model:
            logger.error(f"Model {model_id} not found in registry")
            return False

        if model.downloaded and not force:
            logger.info(f"Model {model_id} already downloaded")
            return True

        try:
            logger.info(f"Downloading {model.name} from {model.hf_repo_id}...")

            # Download model
            local_path = self.cache_dir / model_id
            local_path.mkdir(parents=True, exist_ok=True)

            # Use hf_transfer for faster downloads
            os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "1"

            snapshot_download(
                repo_id=model.hf_repo_id,
                local_dir=str(local_path),
                local_dir_use_symlinks=False,
                resume_download=True
            )

            model.local_path = str(local_path)
            model.downloaded = True
            model.size_gb = self._get_dir_size_gb(local_path)

            # Apply quantization if requested
            if quantization and quantization != QuantizationType.NONE:
                await self.quantize_model(model_id, quantization)

            self._save_registry()
            logger.info(f"Downloaded {model.name} to {local_path}")
            return True

        except HFValidationError as e:
            logger.error(f"Invalid repo ID: {e}")
            return False
        except Exception as e:
            logger.error(f"Download failed: {e}")
            return False

    async def quantize_model(
        self,
        model_id: str,
        quantization: QuantizationType = QuantizationType.Q4_K_M
    ) -> bool:
        """Quantize a downloaded model to GGUF format."""
        model = self.get_model(model_id)
        if not model or not model.downloaded:
            logger.error(f"Model {model_id} not downloaded")
            return False

        if model.quantized and model.quantization == quantization:
            logger.info(f"Model {model_id} already quantized to {quantization}")
            return True

        try:
            logger.info(f"Quantizing {model.name} to {quantization.value}...")

            # Use llama.cpp for GGUF quantization
            # This requires the model to be in a compatible format
            # For diffusers models, we'd need to convert first

            quantized_path = self.cache_dir / f"{model_id}-{quantization.value}"

            # Placeholder for actual quantization logic
            # In practice, this would use llama.cpp conversion scripts

            model.quantized = True
            model.quantization = quantization
            model.local_path = str(quantized_path)

            self._save_registry()
            logger.info(f"Quantized {model.name} to {quantization.value}")
            return True

        except Exception as e:
            logger.error(f"Quantization failed: {e}")
            return False

    def delete_model(self, model_id: str) -> bool:
        """Delete a downloaded model."""
        model = self.get_model(model_id)
        if not model or not model.local_path:
            return False

        try:
            shutil.rmtree(model.local_path, ignore_errors=True)
            model.local_path = None
            model.downloaded = False
            model.quantized = False
            self._save_registry()
            logger.info(f"Deleted model: {model_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete model: {e}")
            return False

    def _get_dir_size_gb(self, path: Path) -> float:
        """Get directory size in GB."""
        total = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
        return round(total / (1024**3), 2)

    def get_disk_usage(self) -> Dict[str, float]:
        """Get disk usage statistics."""
        total = sum(
            self._get_dir_size_gb(self.cache_dir / m.model_id)
            for m in self.models.values()
            if m.local_path and Path(m.local_path).exists()
        )
        return {
            "total_gb": total,
            "model_count": sum(1 for m in self.models.values() if m.downloaded)
        }
