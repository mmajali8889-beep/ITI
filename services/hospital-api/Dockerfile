# Hospital API: production image (24.7/24.8).
# Build:  docker build -t hospital-api services/hospital-api
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Never run as root; secrets arrive as files under /run/secrets, not baked in.
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/health/live >/dev/null || exit 1
CMD ["node", "dist/main"]
