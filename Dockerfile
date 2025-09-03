# =====================================================
#  Chipsy Bot - Dockerfile (unificato)
#  Funziona identico su macOS e VPS (Node 20 LTS)
# =====================================================

# Immagine base leggera e stabile
FROM node:20-alpine

# Imposta working directory
WORKDIR /usr/src/app

# Copia file principali
COPY package*.json ./
COPY . .

# Installa dipendenze di produzione
RUN npm install --omit=dev

# Espone la porta usata dal pannello / API
EXPOSE 8082

# Comando di avvio (ridefinito da docker-compose)
CMD ["npm", "run", "dev:bot"]
