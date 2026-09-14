FROM node:20-slim
WORKDIR /app
COPY apps/api/package.json apps/api/tsconfig.json ./
RUN npm install
COPY apps/api/src ./src
EXPOSE 3001
CMD ["npx", "tsx", "src/index.ts"]
