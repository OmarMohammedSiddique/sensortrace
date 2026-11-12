# Build context: repository root (the API depends on the engine package).
FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /bin/uv
ENV UV_LINK_MODE=copy UV_COMPILE_BYTECODE=1 UV_PYTHON_DOWNLOADS=never
WORKDIR /srv
COPY engine/pyproject.toml engine/uv.lock engine/README.md /srv/engine/
COPY engine/src /srv/engine/src
COPY backend/pyproject.toml backend/uv.lock /srv/backend/
WORKDIR /srv/backend
RUN uv sync --frozen --no-dev --no-editable --no-install-project
COPY backend/app /srv/backend/app
COPY backend/alembic /srv/backend/alembic
COPY backend/alembic.ini /srv/backend/alembic.ini
COPY backend/policies /srv/backend/policies

FROM python:3.12-slim
RUN useradd --system --uid 10001 --no-create-home app
ENV PATH=/srv/backend/.venv/bin:$PATH PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 \
    MPLCONFIGDIR=/tmp OMP_NUM_THREADS=2
COPY --from=build /srv/backend /srv/backend
WORKDIR /srv/backend
USER 10001
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
