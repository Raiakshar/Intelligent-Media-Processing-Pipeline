FROM node:20-bookworm-slim

# sharp needs these for some platforms; slim image keeps this reasonably small.
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

RUN npx prisma generate
RUN npm run build

EXPOSE 3000

# Default command runs the API server; docker-compose overrides this
# for the worker service with `npm run start:worker`.
CMD ["npm", "run", "start"]
