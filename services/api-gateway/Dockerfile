FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
EXPOSE 3000
CMD ["node", "src/index.js"]
