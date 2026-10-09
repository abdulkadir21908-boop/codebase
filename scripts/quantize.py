#!/usr/bin/env python3
"""
Quantize models to GGUF format for CPU inference.
Usage: python quantize.py <model_id> [--type q4_k_m]
"""

import argparse
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.inference.model_manager import ModelManager, QuantizationType


def quantize_with_llama_cpp(model_path: Path, output_path: Path, quantization: QuantizationType) -> bool:
    """Quantize using llama.cpp tools."""
    try:
        # Find llama.cpp quantize binary
        quantize_bin = Path("/usr/local/bin/llama-quantize")
        if not quantize_bin.exists():
            quantize_bin = Path("./llama.cpp/llama-quantize")

        if not quantize_bin.exists():
            print("❌ llama-quantize not found. Build llama.cpp first.")
            return False

        # Find the model file (usually .bin or .gguf)
        model_files = list(model_path.rglob("*.bin")) + list(model_path.rglob("*.gguf"))
        if not model_files:
            print(f"❌ No model file found in {model_path}")
            return False

        input_model = model_files[0]
        output_model = output_path / f"{model_path.name}-{quantization.value}.gguf"
        output_path.mkdir(parents=True, exist_ok=True)

        print(f"🔄 Quantizing {input_model} -> {output_model}")
        print(f"   Quantization: {quantization.value}")

        result = subprocess.run([
            str(quantize_bin),
            str(input_model),
            str(output_model),
            quantization.value
        ], capture_output=True, text=True, timeout=3600)

        if result.returncode == 0:
            print(f"✅ Quantization complete: {output_model}")
            return True
        else:
            print(f"❌ Quantization failed:")
            print(result.stderr)
            return False

    except subprocess.TimeoutExpired:
        print("❌ Quantization timed out")
        return False
    except Exception as e:
        print(f"❌ Quantization error: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Quantize models for CPU inference")
    parser.add_argument("model_id", help="Model ID to quantize")
    parser.add_argument("--type", "-t", choices=[q.value for q in QuantizationType],
                        default="q4_k_m", help="Quantization type")
    parser.add_argument("--registry", default="./models/registry.json", help="Registry path")
    parser.add_argument("--cache", default="./models/cache", help="Cache directory")

    args = parser.parse_args()

    manager = ModelManager(cache_dir=args.cache, registry_path=args.registry)

    model = manager.get_model(args.model_id)
    if not model:
        print(f"❌ Model {args.model_id} not found in registry")
        sys.exit(1)

    if not model.downloaded:
        print(f"❌ Model {args.model_id} not downloaded. Run download_models.py first.")
        sys.exit(1)

    if model.quantized and model.quantization.value == args.type:
        print(f"✅ Model already quantized to {args.type}")
        return

    model_path = Path(model.local_path)
    output_path = Path(args.cache) / f"{model_id}-{args.type}"

    quantization = QuantizationType(args.type)
    success = quantize_with_llama_cpp(model_path, output_path, quantization)

    if success:
        model.quantized = True
        model.quantization = quantization
        model.local_path = str(output_path)
        manager._save_registry()
        print(f"✅ Model quantized and registry updated")
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
