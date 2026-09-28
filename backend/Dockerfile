FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY nest-cli.json prisma.config.ts tsconfig.build.json tsconfig.json ./
COPY prisma ./prisma
COPY src ./src

RUN npm run build

FROM build AS migrate

CMD ["npm", "run", "db:deploy"]

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
COPY prisma.config.ts ./
COPY --from=build /app/dist ./dist

EXPOSE 4000
CMD ["node", "dist/main"]
