# Dockerfile (repo root)
FROM node:20-alpine

WORKDIR /app

# Install deps
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy source
COPY . .

ENV NODE_ENV=production
# DO NOT set ENABLE_STDIO (Smithery wants HTTP, not stdio)

EXPOSE 3000
CMD ["node", "index.js"]
