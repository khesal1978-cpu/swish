FROM node:24-alpine
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY src ./src
ENV NODE_ENV=production HOST=0.0.0.0
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
