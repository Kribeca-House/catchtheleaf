# Build the web app
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Server + built web app in one small image
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production STATIC_DIR=/app/public PORT=8080
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY --from=web /web/dist ./public
USER node
EXPOSE 8080
CMD ["node", "src/index.js"]
