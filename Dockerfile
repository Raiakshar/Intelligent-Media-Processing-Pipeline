FROM node:20-bookworm-slim

# sharp needs these for some platforms; slim image keeps this reasonably small.
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Prisma generate only reads the schema to produce the client; it doesn't
# need a live database connection, but it does need DATABASE_URL to be
# defined so the schema's env() lookup doesn't blow up. Provide a dummy
# value for the build if one isn't supplied, and surface any failure
# loudly instead of silently continuing with a missing/stale client.
ARG DATABASE_URL=postgresql://user:password@localhost:5432/db
ENV DATABASE_URL=${DATABASE_URL}

RUN echo "==> Generating Prisma client" \
    && npx prisma generate \
    || (echo "!!! prisma generate failed" && exit 1)

# Run the TypeScript build with explicit logging so any compiler errors
# are visible in the build output, then verify the expected entrypoint
# was actually produced before moving on. This turns a silent build
# failure into a hard, loud Docker build failure instead of a runtime
# "Cannot find module" crash.
RUN echo "==> Building TypeScript" \
    && npm run build \
    || (echo "!!! npm run build failed" && exit 1)

RUN test -f dist/server.js \
    || (echo "!!! Build did not produce dist/server.js" && ls -la dist || true; exit 1)

EXPOSE 3000

# Default command runs the API server; docker-compose overrides this
# for the worker service with `npm run start:worker`.
CMD ["npm", "run", "start"]
