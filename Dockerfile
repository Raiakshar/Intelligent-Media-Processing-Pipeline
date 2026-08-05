FROM node:20-bookworm-slim

# sharp needs these for some platforms; slim image keeps this reasonably small.
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Backend dependencies ────────────────────────────────────────────────────
COPY package.json package-lock.json* ./
RUN npm install

# ── Frontend dependencies + build ───────────────────────────────────────────
COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN npm install --prefix frontend

COPY . .

# Build frontend (Vite) — VITE_API_BASE_URL is intentionally left unset so
# it falls back to relative URLs; Express serves both on the same origin.
RUN npm run build --prefix frontend

# ── Backend build ───────────────────────────────────────────────────────────
RUN npx prisma generate
RUN npm run build

EXPOSE 3000

# Default command runs migrations + worker + API server
CMD ["npm", "run", "start"]
