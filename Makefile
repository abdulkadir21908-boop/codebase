.PHONY: help install dev test build run clean download-models benchmark

# Default target
help:
	@echo "Higgsfield Local - Development Commands"
	@echo ""
	@echo "Setup:"
	@echo "  make install        Install dependencies"
	@echo "  make download-models Download default models"
	@echo ""
	@echo "Development:"
	@echo "  make dev            Run backend in dev mode"
	@echo "  make frontend       Serve frontend for development"
	@echo "  make test           Run tests"
	@echo "  make lint           Run linters"
	@echo ""
	@echo "Production:"
	@echo "  make build          Build Docker image"
	@echo "  make run            Run with Docker Compose"
	@echo "  make stop           Stop Docker containers"
	@echo "  make logs           View Docker logs"
	@echo ""
	@echo "Utilities:"
	@echo "  make benchmark      Run performance benchmark"
	@echo "  make clean          Clean build artifacts"

# Installation
install:
	pip install -r backend/requirements.txt
	pip install -r backend/requirements-dev.txt
	pre-commit install

# Development
dev:
	DEV_MODE=true python -m backend

frontend:
	cd frontend && python -m http.server 8080

# Testing
test:
	pytest backend/ -v

lint:
	ruff check backend/
	black --check backend/
	mypy backend/

# Docker
build:
	docker-compose build

run:
	docker-compose up -d

stop:
	docker-compose down

logs:
	docker-compose logs -f

# Model management
download-models:
	python scripts/download_models.py all --quantize q4_k_m

download-model:
	@read -p "Model ID: " model; \
	python scripts/download_models.py $$model --quantize q4_k_m

quantize:
	@read -p "Model ID: " model; \
	python scripts/quantize.py $$model --type q4_k_m

# Benchmark
benchmark:
	@read -p "Model ID (default: auto): " model; \
	python scripts/benchmark.py $$model --iterations 5

# Cleanup
clean:
	rm -rf __pycache__ backend/__pycache__ backend/inference/__pycache__ backend/routes/__pycache__
	rm -rf .pytest_cache .mypy_cache .ruff_cache
	rm -rf outputs/
	docker-compose down -v
