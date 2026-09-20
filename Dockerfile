# Image de production : Bun 1.3.14 est requis par le driver QuickJS natif.
FROM oven/bun:1.3.14-slim

WORKDIR /app
ENV NODE_ENV=production

# quickjs-bun compile son bridge natif au premier usage et a besoin des headers C
# même si Bun embarque TinyCC (notamment stdlib.h sur l'image slim).
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends libc6-dev \
  && rm -rf /var/lib/apt/lists/*

# Installer uniquement les dépendances nécessaires à l'exécution.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --chown=bun:bun src ./src
COPY --chown=bun:bun tsconfig.json ./tsconfig.json

USER bun

CMD ["bun", "run", "start"]
