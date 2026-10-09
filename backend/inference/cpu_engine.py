"""
CPU-optimized inference engine for Higgsfield Local.
Supports ComfyUI-style workflows, Diffusers with torch.compile, and GGUF models.
"""

import os
import asyncio
import torch
import logging
from typing import Dict, List, Optional, Any, Union
from pathlib import Path
from dataclasses import dataclass
from enum import Enum
import uuid
from PIL import Image
import numpy as np

logger = logging.getLogger(__name__)


class ModelType(str, Enum):
    IMAGE = "image"
    VIDEO = "video"


class InferenceBackend(str, Enum):
    DIFFUSERS = "diffusers"
    COMFYUI = "comfyui"
    GGUF = "gguf"


@dataclass
class GenerationRequest:
    prompt: str
    negative_prompt: str = ""
    model_id: str = ""
    model_type: ModelType = ModelType.IMAGE
    width: int = 512
    height: int = 512
    num_inference_steps: int = 20
    guidance_scale: float = 7.5
    seed: Optional[int] = None
    fps: int = 8
    num_frames: int = 16
    backend: InferenceBackend = InferenceBackend.DIFFUSERS
    quantization: str = "q4_k_m"


@dataclass
class GenerationResult:
    job_id: str
    model_id: str
    model_type: ModelType
    output_paths: List[str]
    metadata: Dict[str, Any]
    generation_time: float


class CPUInferenceEngine:
    """
    CPU-optimized inference engine supporting multiple backends:
    - Diffusers with torch.compile and channels_last
    - ComfyUI subprocess (for complex workflows)
    - GGUF via llama.cpp (for quantized models)
    """

    def __init__(
        self,
        model_manager: "ModelManager",
        device: str = "cpu",
        torch_compile: bool = True,
        channels_last: bool = True
    ):
        self.model_manager = model_manager
        self.device = torch.device(device)
        self.torch_compile = torch_compile
        self.channels_last = channels_last
        self.loaded_pipelines: Dict[str, Any] = {}
        self.comfyui_process = None

        # Apply CPU optimizations
        self._apply_cpu_optimizations()

    def _apply_cpu_optimizations(self):
        """Apply CPU-specific PyTorch optimizations."""
        torch.set_num_threads(int(os.getenv("TORCH_NUM_THREADS", "4")))
        torch.set_num_interop_threads(2)

        # Enable memory efficient attention if available
        if hasattr(torch.nn.functional, "scaled_dot_product_attention"):
            torch.backends.cuda.enable_flash_sdp(False)
            torch.backends.cuda.enable_mem_efficient_sdp(True)
            torch.backends.cuda.enable_math_sdp(True)

        logger.info(f"CPU optimizations applied: threads={torch.get_num_threads()}")

    async def initialize(self):
        """Initialize the inference engine."""
        logger.info("Initializing CPU inference engine...")

        # Pre-load default model if specified
        default_model = self.model_manager.get_default_model()
        if default_model:
            await self.load_model(default_model.model_id)

        logger.info("CPU inference engine ready")

    async def load_model(self, model_id: str) -> bool:
        """Load a model into memory."""
        if model_id in self.loaded_pipelines:
            logger.info(f"Model {model_id} already loaded")
            return True

        model_info = self.model_manager.get_model(model_id)
        if not model_info:
            logger.error(f"Model {model_id} not found in registry")
            return False

        try:
            logger.info(f"Loading model: {model_id} ({model_info.backend})")

            if model_info.backend == InferenceBackend.DIFFUSERS:
                pipeline = await self._load_diffusers_model(model_info)
            elif model_info.backend == InferenceBackend.GGUF:
                pipeline = await self._load_gguf_model(model_info)
            elif model_info.backend == InferenceBackend.COMFYUI:
                pipeline = await self._load_comfyui_workflow(model_info)
            else:
                raise ValueError(f"Unsupported backend: {model_info.backend}")

            self.loaded_pipelines[model_id] = {
                "pipeline": pipeline,
                "info": model_info,
                "loaded_at": asyncio.get_event_loop().time()
            }

            logger.info(f"Model {model_id} loaded successfully")
            return True

        except Exception as e:
            logger.error(f"Failed to load model {model_id}: {e}")
            return False

    async def _load_diffusers_model(self, model_info) -> Any:
        """Load a Diffusers pipeline with CPU optimizations."""
        from diffusers import (
            DiffusionPipeline,
            StableDiffusionPipeline,
            StableDiffusionXLPipeline,
            FluxPipeline,
            CogVideoXPipeline,
            LTXPipeline
        )
        from diffusers.utils import logging as diffusers_logging

        diffusers_logging.set_verbosity_error()

        # Determine pipeline class
        pipeline_class = self._get_pipeline_class(model_info.pipeline_class)

        # Load pipeline
        pipeline = pipeline_class.from_pretrained(
            model_info.local_path or model_info.hf_repo_id,
            torch_dtype=torch.float16 if self.device.type == "cuda" else torch.float32,
            variant="fp16" if self.device.type == "cuda" else None,
            local_files_only=bool(model_info.local_path),
            use_safetensors=True
        ).to(self.device)

        # Apply CPU optimizations
        if self.channels_last and hasattr(pipeline, "unet"):
            pipeline.unet.to(memory_format=torch.channels_last)
            if hasattr(pipeline, "vae"):
                pipeline.vae.to(memory_format=torch.channels_last)

        if self.torch_compile and hasattr(pipeline, "unet"):
            logger.info("Applying torch.compile to UNet...")
            pipeline.unet = torch.compile(
                pipeline.unet,
                mode="reduce-overhead",
                fullgraph=False
            )
            if hasattr(pipeline, "vae"):
                pipeline.vae = torch.compile(
                    pipeline.vae,
                    mode="reduce-overhead",
                    fullgraph=False
                )

        # Enable attention slicing for memory efficiency
        if hasattr(pipeline, "enable_attention_slicing"):
            pipeline.enable_attention_slicing("auto")

        if hasattr(pipeline, "enable_vae_slicing"):
            pipeline.enable_vae_slicing()

        if hasattr(pipeline, "enable_model_cpu_offload"):
            pipeline.enable_model_cpu_offload()

        return pipeline

    def _get_pipeline_class(self, pipeline_class: str):
        """Get the appropriate Diffusers pipeline class."""
        pipeline_map = {
            "StableDiffusionPipeline": StableDiffusionPipeline,
            "StableDiffusionXLPipeline": StableDiffusionXLPipeline,
            "FluxPipeline": FluxPipeline,
            "CogVideoXPipeline": CogVideoXPipeline,
            "LTXPipeline": LTXPipeline,
        }
        return pipeline_map.get(pipeline_class, DiffusionPipeline)

    async def _load_gguf_model(self, model_info) -> Any:
        """Load a GGUF quantized model via llama.cpp."""
        return {
            "model_path": model_info.local_path,
            "model_info": model_info,
            "type": "gguf"
        }

    async def _load_comfyui_workflow(self, model_info) -> Any:
        """Load a ComfyUI workflow."""
        import json
        with open(model_info.workflow_path, "r") as f:
            workflow = json.load(f)
        return {
            "workflow": workflow,
            "model_info": model_info,
            "type": "comfyui"
        }

    async def generate(self, request: GenerationRequest) -> GenerationResult:
        """Generate image/video based on request."""
        job_id = str(uuid.uuid4())[:8]
        start_time = asyncio.get_event_loop().time()

        # Ensure model is loaded
        if request.model_id not in self.loaded_pipelines:
            success = await self.load_model(request.model_id)
            if not success:
                raise ValueError(f"Failed to load model: {request.model_id}")

        model_data = self.loaded_pipelines[request.model_id]
        pipeline = model_data["pipeline"]
        model_info = model_data["info"]

        # Set seed
        if request.seed is not None:
            torch.manual_seed(request.seed)
            np.random.seed(request.seed)

        try:
            if model_info.backend == InferenceBackend.DIFFUSERS:
                output_paths = await self._generate_diffusers(
                    pipeline, request, model_info
                )
            elif model_info.backend == InferenceBackend.GGUF:
                output_paths = await self._generate_gguf(
                    pipeline, request, model_info
                )
            elif model_info.backend == InferenceBackend.COMFYUI:
                output_paths = await self._generate_comfyui(
                    pipeline, request, model_info
                )
            else:
                raise ValueError(f"Unsupported backend: {model_info.backend}")

            generation_time = asyncio.get_event_loop().time() - start_time

            return GenerationResult(
                job_id=job_id,
                model_id=request.model_id,
                model_type=request.model_type,
                output_paths=output_paths,
                metadata={
                    "prompt": request.prompt,
                    "negative_prompt": request.negative_prompt,
                    "width": request.width,
                    "height": request.height,
                    "steps": request.num_inference_steps,
                    "guidance_scale": request.guidance_scale,
                    "seed": request.seed,
                    "backend": model_info.backend.value,
                    "quantization": request.quantization
                },
                generation_time=generation_time
            )

        except Exception as e:
            logger.error(f"Generation failed: {e}")
            raise

    async def _generate_diffusers(
        self,
        pipeline: Any,
        request: GenerationRequest,
        model_info
    ) -> List[str]:
        """Generate using Diffusers pipeline."""
        output_dir = Path("outputs") / request.model_type.value
        output_dir.mkdir(parents=True, exist_ok=True)

        job_id = str(uuid.uuid4())[:8]

        # Common generation kwargs
        gen_kwargs = {
            "prompt": request.prompt,
            "negative_prompt": request.negative_prompt,
            "num_inference_steps": request.num_inference_steps,
            "guidance_scale": request.guidance_scale,
            "generator": torch.Generator(device=self.device).manual_seed(
                request.seed or torch.randint(0, 2**32, (1,)).item()
            )
        }

        if request.model_type == ModelType.IMAGE:
            gen_kwargs.update({
                "width": request.width,
                "height": request.height
            })

            # Run inference
            with torch.inference_mode():
                result = pipeline(**gen_kwargs)

            images = result.images
            output_paths = []
            for i, img in enumerate(images):
                path = output_dir / f"{job_id}_{i}.png"
                img.save(path)
                output_paths.append(str(path))

        elif request.model_type == ModelType.VIDEO:
            gen_kwargs.update({
                "num_frames": request.num_frames,
                "fps": request.fps
            })

            with torch.inference_mode():
                result = pipeline(**gen_kwargs)

            # Save video
            frames = result.frames[0] if isinstance(result.frames[0], list) else result.frames
            path = output_dir / f"{job_id}.mp4"

            import imageio
            writer = imageio.get_writer(str(path), fps=request.fps)
            for frame in frames:
                if isinstance(frame, torch.Tensor):
                    frame = frame.cpu().numpy()
                writer.append_data(frame)
            writer.close()

            output_paths = [str(path)]

        return output_paths

    async def _generate_gguf(
        self,
        model_data: Dict,
        request: GenerationRequest,
        model_info
    ) -> List[str]:
        """Generate using GGUF model via llama.cpp."""
        raise NotImplementedError("GGUF generation not yet implemented")

    async def _generate_comfyui(
        self,
        model_data: Dict,
        request: GenerationRequest,
        model_info
    ) -> List[str]:
        """Generate using ComfyUI subprocess."""
        raise NotImplementedError("ComfyUI generation not yet implemented")

    def unload_model(self, model_id: str) -> bool:
        """Unload a model from memory."""
        if model_id in self.loaded_pipelines:
            del self.loaded_pipelines[model_id]
            torch.cuda.empty_cache() if self.device.type == "cuda" else None
            logger.info(f"Unloaded model: {model_id}")
            return True
        return False

    async def cleanup(self):
        """Cleanup all resources."""
        self.loaded_pipelines.clear()
        if self.device.type == "cuda":
            torch.cuda.empty_cache()
        logger.info("CPU inference engine cleaned up")

    def get_loaded_models(self) -> List[str]:
        """Get list of currently loaded model IDs."""
        return list(self.loaded_pipelines.keys())

    def get_memory_usage(self) -> Dict[str, float]:
        """Get current memory usage."""
        import psutil
        process = psutil.Process()
        mem = process.memory_info()
        return {
            "rss_mb": mem.rss / (1024 * 1024),
            "vms_mb": mem.vms / (1024 * 1024),
            "percent": process.memory_percent()
        }
