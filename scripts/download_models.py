#!/usr/bin/env python3
"""
Download models from Hugging Face Hub.
Usage: python download_models.py [model_id] [--quantize q4_k_m]
"""

import asyncio
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.inference.model_manager import ModelManager, QuantizationType


async def main():
    parser = argparse.ArgumentParser(description="Download models for Higgsfield Local")
    parser.add_argument("model_id", nargs="?", help="Model ID to download (or 'all' for all models)")
    parser.add_argument("--quantize", "-q", choices=[q.value for q in QuantizationType],
                        default="q4_k_m", help="Quantization type")
    parser.add_argument("--force", "-f", action="store_true", help="Force re-download")
    parser.add_argument("--list", "-l", action="store_true", help="List available models")
    parser.add_argument("--registry", default="./models/registry.json", help="Registry path")
    parser.add_argument("--cache", default="./models/cache", help="Cache directory")

    args = parser.parse_args()

    manager = ModelManager(cache_dir=args.cache, registry_path=args.registry)
    await manager.initialize()

    if args.list:
        print("\nAvailable models:")
        print("-" * 80)
        for model in manager.get_all_models():
            status = "✅" if model.downloaded else "⬜"
            quant = f" ({model.quantization.value})" if model.quantized else ""
            default = " ⭐" if model.is_default else ""
            print(f"{status} {model.model_id}: {model.name}{quant}{default}")
            print(f"    Type: {model.type.value}, Backend: {model.backend.value}, Size: {model.size_gb}GB")
            print(f"    RAM: {model.min_ram_gb}GB min / {model.recommended_ram_gb}GB recommended")
            print(f"    {model.description}")
            print()
        return

    if not args.model_id:
        parser.print_help()
        return

    if args.model_id == "all":
        models_to_download = [m.model_id for m in manager.get_all_models() if not m.downloaded]
        print(f"Downloading {len(models_to_download)} models...")
        for model_id in models_to_download:
            print(f"\n📥 Downloading {model_id}...")
            success = await manager.download_model(model_id, QuantizationType(args.quantize), args.force)
            if success:
                print(f"✅ {model_id} downloaded")
            else:
                print(f"❌ {model_id} failed")
    else:
        print(f"📥 Downloading {args.model_id}...")
        success = await manager.download_model(args.model_id, QuantizationType(args.quantize), args.force)
        if success:
            print(f"✅ {args.model_id} downloaded successfully")
        else:
            print(f"❌ Failed to download {args.model_id}")
            sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
