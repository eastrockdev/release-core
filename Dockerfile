FROM node:22-alpine

# ReleaseCore runtime dependencies:
# - openssl: Prisma/PostgreSQL
# - ffmpeg: WAV -> MP3 preview generation
RUN apk add --no-cache openssl ffmpeg

WORKDIR /app

# Install complete dependency tree for build.
COPY package.json package-lock.json ./
RUN npm ci

# Copy application source.
COPY . .

# Build React Router production bundle.
RUN npm run build

# Remove development-only dependencies after build.
RUN npm prune --omit=dev && npm cache clean --force

ENV NODE_ENV=production
ENV HOST=0.0.0.0

EXPOSE 3000

CMD ["npm", "run", "docker-start"]
