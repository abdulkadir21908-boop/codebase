"""
Job status and system monitoring routes.
"""

import logging
import psutil
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

try:
    import torch
except (ImportError, OSError):
    torch = None

logger = logging.getLogger(__name__)

router = APIRouter()


class SystemStats(BaseModel):
    cpu_percent: float
    memory_percent: float
    memory_used_gb: float
    memory_total_gb: float
    disk_percent: float
    disk_free_gb: float
    gpu_available: bool
    gpu_memory_used: Optional[float] = None
    gpu_memory_total: Optional[float] = None


@router.get("/jobs/{job_id}/status")
async def get_job_status(job_id: str):
    """Get detailed job status."""
    from backend.routes.generate import job_queue, job_results

    if job_id not in job_queue:
        raise HTTPException(404, "Job not found")

    job = job_queue[job_id].copy()

    if job["status"] == "completed" and job_id in job_results:
        job["result"] = job_results[job_id]

    return job


@router.get("/system/stats", response_model=SystemStats)
async def get_system_stats():
    """Get system resource usage."""
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")

    gpu_available = torch is not None and torch.cuda.is_available()

    stats = SystemStats(
        cpu_percent=psutil.cpu_percent(interval=0.1),
        memory_percent=mem.percent,
        memory_used_gb=round(mem.used / (1024**3), 2),
        memory_total_gb=round(mem.total / (1024**3), 2),
        disk_percent=disk.percent,
        disk_free_gb=round(disk.free / (1024**3), 2),
        gpu_available=gpu_available
    )

    if gpu_available:
        stats.gpu_memory_used = round(torch.cuda.memory_allocated() / (1024**3), 2)
        stats.gpu_memory_total = round(torch.cuda.get_device_properties(0).total_memory / (1024**3), 2)

    return stats


@router.get("/queue")
async def get_queue_status():
    """Get generation queue status."""
    from backend.routes.generate import job_queue

    pending = sum(1 for j in job_queue.values() if j["status"] == "pending")
    processing = sum(1 for j in job_queue.values() if j["status"] == "processing")
    completed = sum(1 for j in job_queue.values() if j["status"] == "completed")
    failed = sum(1 for j in job_queue.values() if j["status"] == "failed")

    return {
        "pending": pending,
        "processing": processing,
        "completed": completed,
        "failed": failed,
        "total": len(job_queue)
    }
