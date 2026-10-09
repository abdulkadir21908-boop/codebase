"""Configuration management for Higgsfield Local."""

from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Optional
import os


class Settings(BaseSettings):
    # Higgsfield API
    HIGGSFIELD_API_KEY: Optional[str] = Field(default=None)
    HIGGSFIELD_API_URL: str = Field(default="https://api.higgsfield.ai/v1")

    # Device
    DEFAULT_DEVICE: str = Field(default="cpu")
    TORCH_NUM_THREADS: int = Field(default=4)
    OMP_NUM_THREADS: int = Field(default=4)
    MKL_NUM_THREADS: int = Field(default=4)

    # Model Storage
    MODEL_CACHE_DIR: str = Field(default="./models/cache")
    MODEL_REGISTRY_PATH: str = Field(default="./models/registry.json")

    # Server
    HOST: str = Field(default="0.0.0.0")
    PORT: int = Field(default=7860)
    WORKERS: int = Field(default=1)
    MAX_CONCURRENT_JOBS: int = Field(default=1)
    JOB_TIMEOUT: int = Field(default=300)

    # Inference Optimization
    ENABLE_TORCH_COMPILE: bool = Field(default=True)
    ENABLE_CHANNELS_LAST: bool = Field(default=True)
    USE_FLASH_ATTENTION: bool = Field(default=False)
    PRECISION: str = Field(default="fp16")

    # Quantization
    DEFAULT_QUANTIZATION: str = Field(default="q4_k_m")
    LLAMA_CPP_PATH: str = Field(default="./llama.cpp")

    # Logging
    LOG_LEVEL: str = Field(default="INFO")
    LOG_FORMAT: str = Field(default="json")

    # MCP
    MCP_ENABLED: bool = Field(default=True)
    MCP_HOST: str = Field(default="0.0.0.0")
    MCP_PORT: int = Field(default=7861)

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True


settings = Settings()

# Apply thread settings early
os.environ["OMP_NUM_THREADS"] = str(settings.OMP_NUM_THREADS)
os.environ["MKL_NUM_THREADS"] = str(settings.MKL_NUM_THREADS)
os.environ["TORCH_NUM_THREADS"] = str(settings.TORCH_NUM_THREADS)
