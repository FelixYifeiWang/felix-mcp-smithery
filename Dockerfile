# Use a modern Node with built-in fetch
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Install prod deps first (better caching)
COPY package*.json ./
# Try CI first; fall back to npm i if lockfile missing
RUN npm ci --omit=dev || npm install --omit=dev

# Copy the rest of the source
COPY . .

# Set env for production and enable stdio transport
ENV NODE_ENV=production
ENV ENABLE_STDIO=1

# (Optional) If you ever also serve HTTP/SSE locally:
EXPOSE 3000

# Start your MCP server (Smithery will wrap stdio per smithery.yaml)
CMD ["node", "index.js"]
