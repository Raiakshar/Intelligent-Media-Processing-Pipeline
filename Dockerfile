FROM node:20-bookworm-slim

# sharp needs these for some platforms; slim image keeps this reasonably small.
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# DATABASE_URL is required for `prisma generate` and the build step to run,
# but the real value isn't available until runtime. Accept it as a build
# arg (Railway can pass the real value via --build-arg), falling back to a
# dummy connection string so the build can still succeed without it.
ARG DATABASE_URL
ENV DATABASE_URL=${DATABASE_URL:-postgresql://dummy:dummy@localhost:5432/dummy}

RUN npx prisma generate
RUN npm run build && test -f dist/server.js || (echo "Build failed: dist/server.js not found" && exit 1)

EXPOSE 3000

# Default command runs the API server; docker-compose overrides this
# for the worker service with `npm run start:worker`.
CMD ["npm", "run", "start"]
