FROM node:20
WORKDIR /app
ENV NODE_ENV=production PORT=8081

# deps (works with or without lockfile)
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# app
COPY . .

EXPOSE 8081
HEALTHCHECK --interval=10s --timeout=3s --retries=12 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8081)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
