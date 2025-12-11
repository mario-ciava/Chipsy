# syntax=docker/dockerfile:1.6

FROM node:20-bullseye-slim AS build
WORKDIR /app/panel

# Only public, frontend-safe values should be passed in.
ARG VUE_APP_DISCORD_CLIENT_ID
ENV VUE_APP_DISCORD_CLIENT_ID=${VUE_APP_DISCORD_CLIENT_ID}
# Provide non-sensitive placeholders to satisfy config validation during build.
ENV DISCORD_CLIENT_ID="placeholder-client-id" \
    DISCORD_CLIENT_SECRET="placeholder-client-secret" \
    DISCORD_BOT_TOKEN="placeholder-bot-token" \
    DISCORD_OWNER_ID="000000000000000000"

COPY panel/package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --prefer-offline --no-audit --progress=false
COPY panel/ ./
COPY config /app/config
RUN ln -sfn /app/panel/node_modules /app/node_modules
RUN --mount=type=cache,target=/root/.npm npm run build -- --no-progress

FROM nginx:1.27-alpine AS runtime
COPY panel/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/panel/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
