# Containerfile for KiGentix MCP Bot on WSL
FROM node:20-alpine

# Install system dependencies
RUN apk add --no-cache \
    python3 \
    py3-pip \
    openssh-client \
    curl \
    git \
    bash \
    jq \
    openssh-server \
    shadow

# Create nanobot user (we'll call it "bot" for simplicity)
RUN addgroup -S bot && adduser -S bot -G bot

# Set up home directory
ENV HOME=/home/bot
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy bot code
COPY index.js ./
COPY config/ /app/config/

# Create data directories
RUN mkdir -p /app/data/{logs,state} && \
    chown -R bot:bot /app

# Switch to non-root user
USER bot

# Expose health check port
EXPOSE 3000

# Create a simple health check endpoint
RUN echo '#!/bin/sh\necho "healthy"' > /app/healthcheck.sh && chmod +x /app/healthcheck.sh

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD /app/healthcheck.sh

# Start the bot
CMD ["node", "index.js"]
