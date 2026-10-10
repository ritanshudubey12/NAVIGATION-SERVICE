FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund

FROM deps AS build
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

# docker build --target test ./backend  -> typecheck + unit tests
FROM build AS test
COPY tests ./tests
RUN npm run typecheck && npm test

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 4019
CMD ["node", "dist/server.js"]
