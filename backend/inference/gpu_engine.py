"""
Universal GPU Inference Engine
Supports: NVIDIA CUDA, AMD ROCm, Apple MPS, Intel Arc/Xe, DirectML, OpenVINO
Optimizes every model for maximum speed on each hardware type.
"""

import os
import sys
import time
import json
import logging
import platform
import subprocess
import threading
import queue
from pathlib import Path
from typing import Optional, Dict, Any, Callable, List, Tuple
from dataclasses import dataclass, field
from enum import Enum
import asyncio
from concurrent.futures import ThreadPoolExecutor

import torch
import torch.nn.functional as F

logger = logging.getLogger(__name__)


class GPUType(Enum):
    NVIDIA_CUDA = "nvidia_cuda"
    AMD_ROCM = "amd_rocm"
    APPLE_MPS = "apple_mps"
    INTEL_XE = "intel_xe"
    DIRECTML = "directml"
    OPENVINO = "openvino"
    CPU = "cpu"
    UNKNOWN = "unknown"


class ModelFormat(Enum):
    DIFFUSERS = "diffusers"
    SAFETENSORS = "safetensors"
    ONNX = "onnx"
    TENSORRT = "tensorrt"
    GGUF = "gguf"
    COMFYUI = "comfyui"


@dataclass
class GPUInfo:
    gpu_type: GPUType
    device_name: str
    vram_gb: float
    compute_capability: Optional[str] = None
    driver_version: Optional[str] = None
    backend: str = "unknown"
    optimizations: List[str] = field(default_factory=list)


@dataclass
class ModelConfig:
    model_id: str
    model_type: str  # "image" or "video"
    repo_id: str
    format: ModelFormat = ModelFormat.DIFFUSERS
    quantization: Optional[str] = None  # "fp16", "bf16", "int8", "int4", "fp8"
    compile_mode: Optional[str] = None  # "default", "reduce-overhead", "max-autotune"
    enable_vae_tiling: bool = True
    enable_vae_slicing: bool = True
    enable_attention_slicing: bool = False
    enable_xformers: bool = False
    enable_sdpa: bool = True
    enable_torch_compile: bool = True
    max_batch_size: int = 1
    num_frames: int = 16
    height: int = 576
    width: int = 1024
    num_inference_steps: int = 20
    guidance_scale: float = 7.5
    negative_prompt: str = ""
    seed: int = -1


@dataclass
class GenerationResult:
    success: bool
    output_path: Optional[str] = None
    output_url: Optional[str] = None
    generation_time: float = 0.0
    peak_vram_gb: float = 0.0
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


class GPUDetector:
    """Detects available GPU hardware and capabilities."""

    @staticmethod
    def detect() -> GPUInfo:
        """Detect the best available GPU."""
        # Check NVIDIA CUDA
        if torch.cuda.is_available():
            return GPUDetector._detect_nvidia()
        # Check AMD ROCm
        if hasattr(torch.version, "hip") and torch.version.hip is not None:
            return GPUDetector._detect_amd()
        # Check Apple MPS
        if torch.backends.mps.is_available():
            return GPUDetector._detect_apple()
        # Check Intel XPU
        if hasattr(torch, "xpu") and torch.xpu.is_available():
            return GPUDetector._detect_intel()
        # Check DirectML (Windows)
        if platform.system() == "Windows":
            return GPUDetector._detect_directml()
        # Check OpenVINO
        return GPUDetector._detect_openvino()

    @staticmethod
    def _detect_nvidia() -> GPUInfo:
        device = torch.cuda.get_device_name(0)
        vram = torch.cuda.get_device_properties(0).total_memory / (1024**3)
        cc = torch.cuda.get_device_capability(0)
        cc_str = f"{cc[0]}.{cc[1]}"
        driver = torch.cuda.get_device_properties(0).multi_processor_count

        opts = ["cuda", "fp16", "bf16", "sdpa", "torch_compile"]
        if cc >= (7, 0):
            opts.append("flash_attention")
        if cc >= (8, 0):
            opts.append("fp8")
        if cc >= (8, 6):
            opts.append("tensorrt")

        return GPUInfo(
            gpu_type=GPUType.NVIDIA_CUDA,
            device_name=device,
            vram_gb=vram,
            compute_capability=cc_str,
            driver_version=str(driver),
            backend="cuda",
            optimizations=opts,
        )

    @staticmethod
    def _detect_amd() -> GPUInfo:
        device = torch.cuda.get_device_name(0)
        vram = torch.cuda.get_device_properties(0).total_memory / (1024**3)
        return GPUInfo(
            gpu_type=GPUType.AMD_ROCM,
            device_name=device,
            vram_gb=vram,
            backend="rocm",
            optimizations=["rocm", "fp16", "bf16", "sdpa", "torch_compile"],
        )

    @staticmethod
    def _detect_apple() -> GPUInfo:
        device = platform.processor() or "Apple Silicon"
        vram = 0  # Unified memory, can't easily query
        return GPUInfo(
            gpu_type=GPUType.APPLE_MPS,
            device_name=device,
            vram_gb=vram,
            backend="mps",
            optimizations=["mps", "fp16", "sdpa"],
        )

    @staticmethod
    def _detect_intel() -> GPUInfo:
        device = torch.xpu.get_device_name(0)
        vram = torch.xpu.get_device_properties(0).total_memory / (1024**3)
        return GPUInfo(
            gpu_type=GPUType.INTEL_XE,
            device_name=device,
            vram_gb=vram,
            backend="xpu",
            optimizations=["xpu", "fp16", "sdpa"],
        )

    @staticmethod
    def _detect_directml() -> GPUInfo:
        try:
            import torch_directml
            device = torch_directml.device()
            return GPUInfo(
                gpu_type=GPUType.DIRECTML,
                device_name="DirectML Device",
                vram_gb=0,
                backend="directml",
                optimizations=["directml", "fp16"],
            )
        except ImportError:
            return GPUInfo(
                gpu_type=GPUType.UNKNOWN,
                device_name="Unknown",
                vram_gb=0,
                backend="unknown",
                optimizations=[],
            )

    @staticmethod
    def _detect_openvino() -> GPUInfo:
        try:
            import openvino as ov
            core = ov.Core()
            devices = core.available_devices
            if "GPU" in devices:
                return GPUInfo(
                    gpu_type=GPUType.OPENVINO,
                    device_name="OpenVINO GPU",
                    vram_gb=0,
                    backend="openvino",
                    optimizations=["openvino", "int8"],
                )
        except ImportError:
            pass
        return GPUInfo(
            gpu_type=GPUType.CPU,
            device_name=platform.processor() or "CPU",
            vram_gb=0,
            backend="cpu",
            optimizations=["cpu", "int8"],
        )


class ModelOptimizer:
    """Optimizes models for the detected GPU hardware."""

    def __init__(self, gpu_info: GPUInfo):
        self.gpu_info = gpu_info
        self._compiled_models: Dict[str, Any] = {}

    def optimize_pipeline(self, pipeline: Any, config: ModelConfig) -> Any:
        """Apply all optimizations to a Diffusers pipeline."""
        # Move to device
        device = self._get_device()
        dtype = self._get_dtype()

        pipeline = pipeline.to(device)

        # Set dtype
        if dtype != torch.float32:
            pipeline = pipeline.to(dtype=dtype)

        # Enable VAE tiling and slicing
        if hasattr(pipeline, "vae"):
            if config.enable_vae_tiling:
                pipeline.vae.enable_tiling()
            if config.enable_vae_slicing:
                pipeline.vae.enable_slicing()

        # Enable attention slicing for low VRAM
        if config.enable_attention_slicing and hasattr(pipeline, "enable_attention_slicing"):
            pipeline.enable_attention_slicing()

        # Enable xFormers memory-efficient attention
        if config.enable_xformers and self._can_use_xformers():
            try:
                pipeline.enable_xformers_memory_efficient_attention()
                logger.info("Enabled xFormers memory-efficient attention")
            except Exception as e:
                logger.warning(f"xFormers not available: {e}")

        # Enable PyTorch SDPA (scaled dot-product attention)
        if config.enable_sdpa and hasattr(torch.nn.functional, "scaled_dot_product_attention"):
            if hasattr(pipeline, "set_attn_processor"):
                try:
                    from diffusers.models.attention_processor import AttnProcessor2_0
                    pipeline.set_attn_processor(AttnProcessor2_0())
                    logger.info("Enabled SDPA attention processor")
                except Exception as e:
                    logger.warning(f"SDPA setup failed: {e}")

        # Enable CPU offloading for low VRAM
        if self.gpu_info.vram_gb > 0 and self.gpu_info.vram_gb < 8:
            if hasattr(pipeline, "enable_sequential_cpu_offload"):
                pipeline.enable_sequential_cpu_offload()
                logger.info("Enabled sequential CPU offloading")

        # Enable model CPU offload (keep on GPU, offload between calls)
        elif hasattr(pipeline, "enable_model_cpu_offload"):
            try:
                pipeline.enable_model_cpu_offload()
                logger.info("Enabled model CPU offload")
            except Exception:
                pass

        # Torch compile for maximum speed
        if config.enable_torch_compile and config.compile_mode:
            pipeline = self._compile_pipeline(pipeline, config.compile_mode)

        return pipeline

    def _get_device(self) -> str:
        if self.gpu_info.gpu_type == GPUType.NVIDIA_CUDA:
            return "cuda"
        elif self.gpu_info.gpu_type == GPUType.AMD_ROCM:
            return "cuda"  # ROCm uses CUDA API
        elif self.gpu_info.gpu_type == GPUType.APPLE_MPS:
            return "mps"
        elif self.gpu_info.gpu_type == GPUType.INTEL_XE:
            return "xpu"
        return "cpu"

    def _get_dtype(self) -> torch.dtype:
        if self.gpu_info.gpu_type in (GPUType.NVIDIA_CUDA, GPUType.AMD_ROCM):
            if self.gpu_info.compute_capability and self._cc_gte((8, 0)):
                return torch.float16  # FP16 for Ampere+
            return torch.float16
        elif self.gpu_info.gpu_type == GPUType.APPLE_MPS:
            return torch.float16
        return torch.float32

    def _cc_gte(self, target: Tuple[int, int]) -> bool:
        if not self.gpu_info.compute_capability:
            return False
        major, minor = map(int, self.gpu_info.compute_capability.split("."))
        return (major, minor) >= target

    def _can_use_xformers(self) -> bool:
        try:
            import xformers
            import xformers.ops
            return True
        except ImportError:
            return False

    def _compile_pipeline(self, pipeline: Any, mode: str) -> Any:
        """Apply torch.compile to the UNet/Transformer for maximum speed."""
        try:
            if hasattr(pipeline, "unet"):
                pipeline.unet = torch.compile(pipeline.unet, mode=mode, fullgraph=False)
                logger.info(f"Compiled UNet with mode={mode}")
            elif hasattr(pipeline, "transformer"):
                pipeline.transformer = torch.compile(pipeline.transformer, mode=mode, fullgraph=False)
                logger.info(f"Compiled Transformer with mode={mode}")
        except Exception as e:
            logger.warning(f"Torch compile failed: {e}")
        return pipeline

    def optimize_for_inference(self, model: Any) -> Any:
        """Apply inference optimizations to a raw model."""
        model.eval()
        if hasattr(model, "requires_grad_"):
            model.requires_grad_(False)
        return model


class GPUInferenceEngine:
    """
    Universal GPU inference engine.
    Auto-detects hardware, loads models with optimal settings, generates content.
    """

    def __init__(self, model_dir: str = "./models", cache_dir: str = "./cache"):
        self.model_dir = Path(model_dir)
        self.cache_dir = Path(cache_dir)
        self.model_dir.mkdir(parents=True, exist_ok=True)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        self.gpu_info = GPUDetector.detect()
        self.optimizer = ModelOptimizer(self.gpu_info)
        self._pipelines: Dict[str, Any] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=1)
        self._job_queue: queue.Queue = queue.Queue()
        self._running = False
        self._worker_thread: Optional[threading.Thread] = None

        logger.info(f"GPU Engine initialized: {self.gpu_info.device_name} ({self.gpu_info.gpu_type.value})")
        logger.info(f"VRAM: {self.gpu_info.vram_gb:.1f} GB, Backend: {self.gpu_info.backend}")
        logger.info(f"Optimizations: {', '.join(self.gpu_info.optimizations)}")

    def start(self):
        """Start the background worker thread."""
        self._running = True
        self._worker_thread = threading.Thread(target=self._worker_loop, daemon=True)
        self._worker_thread.start()
        logger.info("GPU inference worker started")

    def stop(self):
        """Stop the background worker."""
        self._running = False
        if self._worker_thread:
            self._worker_thread.join(timeout=30)
        self._executor.shutdown(wait=False)
        logger.info("GPU inference worker stopped")

    def _worker_loop(self):
        """Background worker that processes generation jobs."""
        while self._running:
            try:
                job = self._job_queue.get(timeout=1)
                self._process_job(job)
            except queue.Empty:
                continue
            except Exception as e:
                logger.error(f"Worker error: {e}")

    def _process_job(self, job: Dict[str, Any]):
        """Process a single generation job."""
        try:
            config = job["config"]
            callback = job.get("callback")
            result = self.generate(config)
            if callback:
                callback(result)
        except Exception as e:
            logger.error(f"Job processing error: {e}")
            if job.get("callback"):
                job["callback"](GenerationResult(success=False, error=str(e)))

    def submit_job(self, config: ModelConfig, callback: Optional[Callable] = None) -> str:
        """Submit a generation job to the queue."""
        job_id = f"job_{int(time.time() * 1000)}"
        job = {"id": job_id, "config": config, "callback": callback}
        self._job_queue.put(job)
        return job_id

    def generate(self, config: ModelConfig) -> GenerationResult:
        """Generate image or video with the given configuration."""
        start_time = time.time()

        try:
            if config.model_type == "image":
                return self._generate_image(config, start_time)
            elif config.model_type == "video":
                return self._generate_video(config, start_time)
            else:
                return GenerationResult(
                    success=False,
                    error=f"Unknown model type: {config.model_type}",
                    generation_time=time.time() - start_time,
                )
        except Exception as e:
            logger.error(f"Generation failed: {e}", exc_info=True)
            return GenerationResult(
                success=False,
                error=str(e),
                generation_time=time.time() - start_time,
            )

    def _generate_image(self, config: ModelConfig, start_time: float) -> GenerationResult:
        """Generate an image using the optimal pipeline."""
        from diffusers import DiffusionPipeline

        # Load or get cached pipeline
        pipeline = self._get_pipeline(config)

        # Set seed
        generator = None
        if config.seed >= 0:
            device = self.optimizer._get_device()
            generator = torch.Generator(device=device).manual_seed(config.seed)

        # Generate
        with torch.inference_mode():
            output = pipeline(
                prompt=config.prompt,
                negative_prompt=config.negative_prompt if config.negative_prompt else None,
                num_inference_steps=config.num_inference_steps,
                guidance_scale=config.guidance_scale,
                height=config.height,
                width=config.width,
                generator=generator,
            )

        # Save output
        output_path = self._save_output(output, config, "image")

        # Get peak VRAM
        peak_vram = self._get_peak_vram()

        return GenerationResult(
            success=True,
            output_path=str(output_path),
            generation_time=time.time() - start_time,
            peak_vram_gb=peak_vram,
            metadata={
                "model_id": config.model_id,
                "prompt": config.prompt,
                "steps": config.num_inference_steps,
                "resolution": f"{config.width}x{config.height}",
            },
        )

    def _generate_video(self, config: ModelConfig, start_time: float) -> GenerationResult:
        """Generate a video using the optimal pipeline."""
        from diffusers import DiffusionPipeline

        pipeline = self._get_pipeline(config)

        generator = None
        if config.seed >= 0:
            device = self.optimizer._get_device()
            generator = torch.Generator(device=device).manual_seed(config.seed)

        with torch.inference_mode():
            output = pipeline(
                prompt=config.prompt,
                negative_prompt=config.negative_prompt if config.negative_prompt else None,
                num_frames=config.num_frames,
                num_inference_steps=config.num_inference_steps,
                guidance_scale=config.guidance_scale,
                height=config.height,
                width=config.width,
                generator=generator,
            )

        output_path = self._save_output(output, config, "video")
        peak_vram = self._get_peak_vram()

        return GenerationResult(
            success=True,
            output_path=str(output_path),
            generation_time=time.time() - start_time,
            peak_vram_gb=peak_vram,
            metadata={
                "model_id": config.model_id,
                "prompt": config.prompt,
                "frames": config.num_frames,
                "fps": 8,
                "resolution": f"{config.width}x{config.height}",
            },
        )

    def _get_pipeline(self, config: ModelConfig) -> Any:
        """Get or load a pipeline with caching."""
        cache_key = f"{config.model_id}_{config.quantization or 'default'}"

        with self._lock:
            if cache_key in self._pipelines:
                return self._pipelines[cache_key]

        # Load pipeline
        pipeline = self._load_pipeline(config)

        # Optimize
        pipeline = self.optimizer.optimize_pipeline(pipeline, config)

        # Cache
        with self._lock:
            self._pipelines[cache_key] = pipeline

        return pipeline

    def _load_pipeline(self, config: ModelConfig) -> Any:
        """Load a Diffusers pipeline with optimal settings."""
        from diffusers import DiffusionPipeline

        device = self.optimizer._get_device()
        dtype = self.optimizer._get_dtype()

        # Load with optimal settings
        load_kwargs = {
            "torch_dtype": dtype,
            "cache_dir": str(self.cache_dir),
            "local_files_only": False,
        }

        # Add quantization if specified
        if config.quantization == "int8":
            load_kwargs["load_in_8bit"] = True
        elif config.quantization == "int4":
            load_kwargs["load_in_4bit"] = True

        # Load from local path or HuggingFace
        local_path = self.model_dir / config.model_id
        if local_path.exists():
            pipeline = DiffusionPipeline.from_pretrained(str(local_path), **load_kwargs)
        else:
            pipeline = DiffusionPipeline.from_pretrained(config.repo_id, **load_kwargs)

        return pipeline

    def _save_output(self, output: Any, config: ModelConfig, output_type: str) -> Path:
        """Save generated output to disk."""
        timestamp = int(time.time())
        output_dir = self.cache_dir / output_type
        output_dir.mkdir(parents=True, exist_ok=True)

        if output_type == "image":
            path = output_dir / f"{config.model_id}_{timestamp}.png"
            output.images[0].save(path)
        elif output_type == "video":
            path = output_dir / f"{config.model_id}_{timestamp}.mp4"
            # Save video frames
            if hasattr(output, "frames"):
                frames = output.frames[0] if isinstance(output.frames[0], list) else output.frames
                self._save_video_frames(frames, path)
            else:
                output.images[0].save(path.with_suffix(".png"))

        return path

    def _save_video_frames(self, frames: List, path: Path):
        """Save video frames as MP4 using imageio."""
        try:
            import imageio
            imageio.mimsave(path, frames, fps=8, codec="libx264")
        except ImportError:
            # Fallback: save as GIF
            try:
                import imageio
                imageio.mimsave(path.with_suffix(".gif"), frames, fps=8)
            except ImportError:
                # Last resort: save first frame
                frames[0].save(path.with_suffix(".png"))

    def _get_peak_vram(self) -> float:
        """Get peak VRAM usage in GB."""
        if self.gpu_info.gpu_type in (GPUType.NVIDIA_CUDA, GPUType.AMD_ROCM):
            return torch.cuda.max_memory_allocated() / (1024**3)
        return 0.0

    def clear_cache(self):
        """Clear all cached pipelines and free VRAM."""
        with self._lock:
            self._pipelines.clear()
        if self.gpu_info.gpu_type in (GPUType.NVIDIA_CUDA, GPUType.AMD_ROCM):
            torch.cuda.empty_cache()
        logger.info("Model cache cleared")

    def get_status(self) -> Dict[str, Any]:
        """Get current engine status."""
        return {
            "gpu": {
                "type": self.gpu_info.gpu_type.value,
                "name": self.gpu_info.device_name,
                "vram_gb": self.gpu_info.vram_gb,
                "backend": self.gpu_info.backend,
                "optimizations": self.gpu_info.optimizations,
            },
            "cached_models": list(self._pipelines.keys()),
            "queue_size": self._job_queue.qsize(),
            "peak_vram_gb": self._get_peak_vram(),
        }


# Singleton instance
_engine: Optional[GPUInferenceEngine] = None


def get_engine() -> GPUInferenceEngine:
    """Get or create the singleton GPU engine."""
    global _engine
    if _engine is None:
        _engine = GPUInferenceEngine()
        _engine.start()
    return _engine
