# =====================================================
#  Chipsy Bot - unified Dockerfile
#  Same behavior on macOS and VPS (Node 20 LTS)
# =====================================================

# Lightweight base image that won't melt build times
FROM node:20-alpine

# Working directory inside the container
WORKDIR /usr/src/app

# Copy manifests first for layer caching
COPY package*.json ./
COPY . .

# Install prod dependencies only; dev stuff stays outside the container
RUN npm install --omit=dev

# Expose the panel/API port for whoever is reverse-proxying this mess
EXPOSE 8082

# Default start command (docker-compose can still override it)
CMD ["npm", "run", "dev:bot"]
