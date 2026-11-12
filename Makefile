# SensorTrace developer commands. Run `make help`.
SHELL := /bin/bash
.DEFAULT_GOAL := help

help: ## list commands
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-20s %s\n", $$1, $$2}'

install: ## install all dependencies
	cd engine && uv sync
	cd backend && uv sync
	cd frontend && npm ci

services: ## start PostgreSQL, Redis and the object store
	docker compose up -d --wait db redis objectstore

migrate: services ## apply database migrations
	cd backend && uv run alembic upgrade head

dev-api: ## run the API on 127.0.0.1:8100 (host)
	cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8100 --reload

dev-worker: ## run a background worker (host)
	cd backend && OBJC_DISABLE_INITIALIZE_FORK_SAFETY=YES uv run python -m app.cli worker

dev-web: ## run the web application on :3100 (host)
	cd frontend && npm run dev

up: ## build and start the complete stack in Docker
	docker compose --profile app up --build -d --wait
	@echo "Web: http://localhost:$${WEB_PORT:-3100}   API docs: http://127.0.0.1:$${API_PORT:-8100}/api/v1/docs"

down: ## stop the stack (data volumes are kept)
	docker compose --profile app down

logs: ## follow logs
	docker compose --profile app logs -f --tail=100

lint: ## lint and type-check everything
	cd engine && uv run ruff check src tests && uv run ruff format --check src tests
	cd backend && uv run ruff check app tests && uv run ruff format --check app tests
	cd frontend && npm run lint && npx tsc --noEmit

test-engine: ## engine unit, regression and reference cross-check tests
	cd engine && uv run pytest -q

test-backend: services ## backend integration tests (needs the services)
	cd backend && uv run pytest -q

test-e2e: ## browser end-to-end tests against the running stack
	cd frontend && npx playwright test

test: test-engine test-backend ## engine and backend tests

build-web: ## production build of the web application
	cd frontend && npm run build

openapi: ## regenerate docs/api/openapi.json and the typed client
	cd backend && uv run python -m app.cli openapi > ../docs/api/openapi.json
	cd frontend && npm run gen:api

reference-oracle: ## fetch the independent reference implementation (dev-only test oracle)
	scripts/fetch_reference_implementation.sh

eval-data: ## download the VISION evaluation subset (2.8 GB, CC BY-SA 4.0)
	scripts/download_vision_subset.sh data/vision 40

evaluate: ## run the empirical evaluation (about one hour)
	cd engine && uv run sensortrace evaluate evaluation/vision_subset_v1.json --out ../data/eval/vision_subset_v1 --workers 6

audit: ## dependency vulnerability checks
	cd engine && uv run --with pip-audit pip-audit
	cd backend && uv run --with pip-audit pip-audit
	cd frontend && npm audit --omit=dev

.PHONY: help install services migrate dev-api dev-worker dev-web up down logs lint test-engine test-backend test-e2e test build-web openapi reference-oracle eval-data evaluate audit
