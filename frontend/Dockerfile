# Frontend — Vite build → nginx serves the SPA and reverse-proxies /api
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Same-origin deploys behind the bundled nginx use the relative API prefix
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
    CMD ["wget", "-qO-", "http://127.0.0.1/healthz"]

EXPOSE 80
