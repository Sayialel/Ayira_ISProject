FROM node:20-slim
WORKDIR /app
COPY apps/web/package.json apps/web/vite.config.ts apps/web/tsconfig.json apps/web/tailwind.config.js apps/web/postcss.config.js ./
RUN npm install
COPY apps/web/ .
EXPOSE 5173
CMD ["npx", "vite", "--host"]
