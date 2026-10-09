"""
Higgsfield API client for cloud generation fallback.
"""

import asyncio
import aiohttp
import logging
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from pathlib import Path
import uuid

logger = logging.getLogger(__name__)


@dataclass
class HiggsfieldModel:
    id: str
    name: str
    type: str  # "image" or "video"
    description: str
    params: Dict[str, Any]


@dataclass
class GenerationJob:
    job_id: str
    status: str  # "pending", "processing", "completed", "failed"
    result_urls: List[str] = None
    error: str = None
    progress: float = 0.0


class HiggsfieldAPIClient:
    """
    Client for Higgsfield Cloud API.
    Used as fallback when local models are insufficient.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.higgsfield.ai/v1",
        timeout: int = 300
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = aiohttp.ClientTimeout(total=timeout)
        self.session: Optional[aiohttp.ClientSession] = None
        self._models_cache: List[HiggsfieldModel] = []

    async def __aenter__(self):
        await self._ensure_session()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()

    async def _ensure_session(self):
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession(
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=self.timeout
            )

    async def close(self):
        if self.session and not self.session.closed:
            await self.session.close()

    async def list_models(self) -> List[HiggsfieldModel]:
        """List available models from Higgsfield API."""
        if self._models_cache:
            return self._models_cache

        await self._ensure_session()
        async with self.session.get(f"{self.base_url}/models") as resp:
            if resp.status == 200:
                data = await resp.json()
                self._models_cache = [
                    HiggsfieldModel(**m) for m in data.get("models", [])
                ]
                return self._models_cache
            else:
                logger.error(f"Failed to list models: {resp.status}")
                return []

    async def generate_image(
        self,
        prompt: str,
        model_id: str,
        negative_prompt: str = "",
        width: int = 1024,
        height: int = 1024,
        steps: int = 20,
        guidance_scale: float = 7.5,
        seed: Optional[int] = None,
        num_images: int = 1
    ) -> GenerationJob:
        """Submit an image generation job."""
        await self._ensure_session()

        payload = {
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "model": model_id,
            "width": width,
            "height": height,
            "steps": steps,
            "guidance_scale": guidance_scale,
            "num_images": num_images
        }
        if seed is not None:
            payload["seed"] = seed

        async with self.session.post(
            f"{self.base_url}/generate/image",
            json=payload
        ) as resp:
            if resp.status == 200:
                data = await resp.json()
                return GenerationJob(
                    job_id=data["job_id"],
                    status=data["status"]
                )
            else:
                error = await resp.text()
                logger.error(f"Image generation failed: {error}")
                raise Exception(f"API error: {error}")

    async def generate_video(
        self,
        prompt: str,
        model_id: str,
        negative_prompt: str = "",
        width: int = 512,
        height: int = 512,
        num_frames: int = 16,
        fps: int = 8,
        steps: int = 20,
        guidance_scale: float = 7.5,
        seed: Optional[int] = None
    ) -> GenerationJob:
        """Submit a video generation job."""
        await self._ensure_session()

        payload = {
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "model": model_id,
            "width": width,
            "height": height,
            "num_frames": num_frames,
            "fps": fps,
            "steps": steps,
            "guidance_scale": guidance_scale
        }
        if seed is not None:
            payload["seed"] = seed

        async with self.session.post(
            f"{self.base_url}/generate/video",
            json=payload
        ) as resp:
            if resp.status == 200:
                data = await resp.json()
                return GenerationJob(
                    job_id=data["job_id"],
                    status=data["status"]
                )
            else:
                error = await resp.text()
                logger.error(f"Video generation failed: {error}")
                raise Exception(f"API error: {error}")

    async def get_job_status(self, job_id: str) -> GenerationJob:
        """Get status of a generation job."""
        await self._ensure_session()

        async with self.session.get(f"{self.base_url}/jobs/{job_id}") as resp:
            if resp.status == 200:
                data = await resp.json()
                return GenerationJob(
                    job_id=data["job_id"],
                    status=data["status"],
                    result_urls=data.get("result_urls"),
                    error=data.get("error"),
                    progress=data.get("progress", 0.0)
                )
            else:
                error = await resp.text()
                logger.error(f"Failed to get job status: {error}")
                raise Exception(f"API error: {error}")

    async def wait_for_completion(
        self,
        job_id: str,
        poll_interval: float = 2.0,
        max_wait: float = 300.0
    ) -> GenerationJob:
        """Poll job until completion."""
        waited = 0.0
        while waited < max_wait:
            job = await self.get_job_status(job_id)
            if job.status in ("completed", "failed"):
                return job
            await asyncio.sleep(poll_interval)
            waited += poll_interval

        raise TimeoutError(f"Job {job_id} did not complete within {max_wait}s")

    async def download_results(self, job: GenerationJob, output_dir: Path) -> List[Path]:
        """Download result files from job URLs."""
        if not job.result_urls:
            return []

        await self._ensure_session()
        output_dir.mkdir(parents=True, exist_ok=True)
        downloaded = []

        for i, url in enumerate(job.result_urls):
            async with self.session.get(url) as resp:
                if resp.status == 200:
                    ext = Path(url).suffix or ".png"
                    filename = f"{job.job_id}_{i}{ext}"
                    filepath = output_dir / filename

                    with open(filepath, "wb") as f:
                        async for chunk in resp.content.iter_chunked(8192):
                            f.write(chunk)
                    downloaded.append(filepath)

        return downloaded
