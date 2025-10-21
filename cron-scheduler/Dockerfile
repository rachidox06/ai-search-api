FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Run as non-root user
USER node

# Start the cron scheduler
CMD ["node", "index.js"]

