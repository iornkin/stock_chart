# US Stock Insight — 웹 서버 + 스케줄러 워커 단일 컨테이너
FROM node:22-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/app/data/app.db
VOLUME ["/app/data"]
EXPOSE 3000
CMD ["node", "scripts/start-all.mjs"]
