# ── build ────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ── serve: nginx static + same-origin /api proxy ─────────
FROM nginx:1.27-alpine
# PORT is injected by Railway. BACKEND_URL = backend's private URL, e.g. http://backend.railway.internal:4000
ENV PORT=8080 \
    BACKEND_URL=http://backend:4000 \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
