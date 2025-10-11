# syntax=docker/dockerfile:1.6

FROM node:20-bullseye-slim AS base
WORKDIR /usr/src/app
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        python3 \
        make \
        g++ \
        pkg-config \
        libcairo2-dev \
        libjpeg-dev \
        libpango1.0-dev \
        libgif-dev \
        librsvg2-dev \
        libpng-dev \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

CMD ["node", "bot/index.js"]
