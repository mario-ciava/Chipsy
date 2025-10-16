# syntax=docker/dockerfile:1.6

FROM node:20-bullseye-slim AS build
WORKDIR /app/panel
COPY panel/package*.json ./
RUN npm ci
COPY panel/ ./
COPY config /app/config
RUN ln -sfn /app/panel/node_modules /app/node_modules
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY panel/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/panel/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
