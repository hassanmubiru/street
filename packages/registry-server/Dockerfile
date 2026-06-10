# packages/registry-server/Dockerfile
#
# Production container image for the @streetjs/registry-server Network Plugin
# Registry (Requirement 4). Build context is this package directory:
#
#   docker build -t streetjs-registry packages/registry-server
#   docker run --rm -p 8787:8787 \
#     -e STREET_REGISTRY_PUBLISHERS='[{"id":"acme","apiKey":"secret","namespaces":["acme"]}]' \
#     streetjs-registry
#
# The publish→install E2E verification harness (scripts/registry/e2e.mjs) runs
# the server in a container using the official node image with the repo mounted,
# which needs no image build; this Dockerfile is the canonical production image.
#
# Zero runtime deps in core; the server's only dependency is `streetjs` itself,
# installed from the npm registry at the version pinned in package.json.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
COPY tsconfig.json ./
COPY src ./src
RUN npm install --no-audit --no-fund \
  && npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Install only production dependencies (streetjs core, zero further runtime deps).
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist

# Non-root for least privilege.
USER node
ENV PORT=8787 HOST=0.0.0.0
EXPOSE 8787
CMD ["node", "dist/cli.js"]
