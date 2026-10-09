#!/usr/bin/env python3
"""
Benchmark script for CPU inference performance.
Usage: python benchmark.py [model_id] [--iterations 5]
"""

import asyncio
import argparse
import time
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.inference.model_manager import ModelManager
from backend.inference.cpu_engine import CPUInferenceEngine, GenerationRequest, ModelType
from backend.config import settings


async def main():
    parser = argparse.ArgumentParser(description="Benchmark CPU inference performance")
    parser.add_argument("model_id", nargs="?", help="Model ID to benchmark")
    parser.add_argument("--iterations", "-n", type=int, default=3, help="Number of iterations")
    parser.add_argument("--warmup", "-w", type=int, default=1, help="Warmup iterations")
    parser.add_argument("--prompt", "-p", default="A beautiful landscape, photorealistic, 8k",
                        help="Test prompt")
    parser.add_argument("--registry", default="./models/registry.json", help="Registry path")
    parser.add_argument("--cache", default="./models/cache", help="Cache directory")
    parser.add_argument("--device", default="cpu", choices=["cpu", "cuda"], help="Device")

    args = parser.parse_args()

    # Initialize
    manager = ModelManager(cache_dir=args.cache, registry_path=args.registry)
    await manager.initialize()

    # Get model
    if args.model_id:
        model = manager.get_model(args.model_id)
        if not model:
            print(f"❌ Model {args.model_id} not found")
            sys.exit(1)
    else:
        model = manager.get_default_model()
        if not model:
            print("❌ No default model found")
            sys.exit(1)

    if not model.downloaded:
        print(f"❌ Model {model.model_id} not downloaded. Run download_models.py first.")
        sys.exit(1)

    print(f"🔬 Benchmarking {model.name} ({model.model_id})")
    print(f"   Device: {args.device}")
    print(f"   Iterations: {args.iterations} (+{args.warmup} warmup)")
    print(f"   Prompt: {args.prompt}")
    print()

    # Initialize engine
    engine = CPUInferenceEngine(
        model_manager=manager,
        device=args.device,
        torch_compile=settings.ENABLE_TORCH_COMPILE,
        channels_last=settings.ENABLE_CHANNELS_LAST
    )
    await engine.initialize()

    # Load model
    print("📥 Loading model...")
    load_start = time.time()
    success = await engine.load_model(model.model_id)
    load_time = time.time() - load_start

    if not success:
        print("❌ Failed to load model")
        sys.exit(1)

    print(f"✅ Model loaded in {load_time:.2f}s")
    print()

    # Warmup
    print(f"🔥 Warming up ({args.warmup} iterations)...")
    for i in range(args.warmup):
        request = GenerationRequest(
            prompt=args.prompt,
            model_id=model.model_id,
            model_type=model.type,
            width=512,
            height=512,
            num_inference_steps=4 if "turbo" in model.model_id else 20,
            guidance_scale=0.0 if "turbo" in model.model_id else 7.5,
            seed=42
        )
        await engine.generate(request)
        print(f"   Warmup {i+1}/{args.warmup} done")

    # Benchmark
    print(f"\n⏱️  Benchmarking ({args.iterations} iterations)...")
    times = []

    for i in range(args.iterations):
        request = GenerationRequest(
            prompt=args.prompt,
            model_id=model.model_id,
            model_type=model.type,
            width=512,
            height=512,
            num_inference_steps=4 if "turbo" in model.model_id else 20,
            guidance_scale=0.0 if "turbo" in model.model_id else 7.5,
            seed=None  # Random seed for each run
        )

        start = time.time()
        result = await engine.generate(request)
        elapsed = time.time() - start
        times.append(elapsed)

        print(f"   Run {i+1}/{args.iterations}: {elapsed:.2f}s ({result.generation_time:.2f}s pure inference)")

    # Stats
    print("\n📊 Results:")
    print(f"   Mean:     {statistics.mean(times):.2f}s")
    print(f"   Median:   {statistics.median(times):.2f}s")
    print(f"   Stdev:    {statistics.stdev(times):.2f}s" if len(times) > 1 else "   Stdev:    N/A")
    print(f"   Min:      {min(times):.2f}s")
    print(f"   Max:      {max(times):.2f}s")
    print(f"   Throughput: {1/statistics.mean(times):.2f} it/s")

    # Memory
    mem = engine.get_memory_usage()
    print(f"\n💾 Memory Usage:")
    print(f"   RSS: {mem['rss_mb']:.0f} MB")
    print(f"   VMS: {mem['vms_mb']:.0f} MB")

    await engine.cleanup()


if __name__ == "__main__":
    asyncio.run(main())
