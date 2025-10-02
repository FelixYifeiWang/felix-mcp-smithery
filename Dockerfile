# Dockerfile
FROM node:20

WORKDIR /app

# Install deps
COPY package*.json ./
RUN npm install --omit=dev

# Copy source
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "index.js"]
