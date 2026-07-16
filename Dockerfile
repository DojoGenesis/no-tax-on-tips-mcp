# syntax=docker/dockerfile:1

# Builder — needs devDependencies (typescript) to compile src/ into dist/.
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
# --ignore-scripts: the "prepare" lifecycle script runs `npm run build`, which
# needs src/ and the tsconfigs — not copied yet at this layer. Build explicitly below.
RUN npm ci --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# Runtime — production dependencies only.
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# --ignore-scripts again: "prepare" would invoke tsc, which is absent from
# production dependencies.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder --chown=node:node /app/dist ./dist

USER node

# stdio transport: the MCP client speaks JSON-RPC over stdin/stdout, so nothing
# is exposed on a port and nothing may be written to stdout but protocol frames.
ENTRYPOINT ["node", "dist/index.js"]
