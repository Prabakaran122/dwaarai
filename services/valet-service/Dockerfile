FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN corepack enable && pnpm install
COPY . .
EXPOSE 3060
CMD ["node", "src/index.js"]
