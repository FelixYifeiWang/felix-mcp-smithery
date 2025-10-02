# Dockerfile
FROM node:20-alpine

WORKDIR /app

# install deps
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# copy source
COPY . .

ENV NODE_ENV=production
# (Do NOT set ENABLE_STDIO here; Smithery wants HTTP, not stdio)

EXPOSE 3000
CMD ["node", "index.js"]
