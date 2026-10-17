# EHR web app served by Caddy, which also terminates TLS and routes /api,
# /ohif and /dicom-web to the hospital API (see infrastructure/production).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Same-origin URLs: one HTTPS address serves the app, the API and the viewer.
ENV VITE_HOSPITAL_API_URL=/api VITE_OHIF_URL=/ohif
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
