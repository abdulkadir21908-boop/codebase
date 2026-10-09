"""Inference engines for Higgsfield Local."""
from backend.inference.model_manager import ModelManager

# Optional imports - require torch
try:
    from backend.inference.cpu_engine import CPUInferenceEngine
except (ImportError, OSError):
    CPUInferenceEngine = None

try:
    from backend.inference.api_client import HiggsfieldAPIClient
except (ImportError, OSError):
    HiggsfieldAPIClient = None

__all__ = ["ModelManager", "CPUInferenceEngine", "HiggsfieldAPIClient"]
