# ---- Base image ----
FROM node:20

# Ensure consistent working dir
WORKDIR /app

# ---- Dependency install (cacheable) ----
# Copy only manifests first to maximize layer caching
COPY package.json package-lock.json ./

# Bust cache intentionally when needed (bump this number if builds get "stuck")
ARG BUILD_REV=1
ENV BUILD_REV=${BUILD_REV}

# Install production deps
RUN npm ci --omit=dev || npm install --omit=dev

# ---- App source ----
COPY . .

# Environment & port
ENV NODE_ENV=production
EXPOSE 3000

# ---- Start ----
CMD ["node", "index.js"]
