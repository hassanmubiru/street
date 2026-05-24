# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
RUN npx tsc

# ---- Production stage ----
FROM gcr.io/distroless/nodejs20-debian12 AS runtime
WORKDIR /app

# Copy compiled output
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package.json ./package.json

# Migrations are plain SQL, copy as-is
COPY migrations ./migrations

# Upload directory (will be mounted as volume in production)
RUN mkdir -p uploads

# Non-root execution (distroless runs as nonroot by default uid=65532)
USER nonroot

EXPOSE 3000

ENV NODE_ENV=production

ENTRYPOINT ["nodejs", "dist/src/main.js"]
