# Use Node 18 full Debian image (not Alpine) — has build tools included
FROM node:18-slim

# Install build tools needed for better-sqlite3 to compile
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Set working directory inside container
WORKDIR /app

# Copy package files first (for layer caching)
COPY package*.json ./

# Install ALL dependencies (including dev, needed for native build)
RUN npm install

# Copy rest of the project
COPY . .

# Create db directory
RUN mkdir -p db

# Set up the database with sample users
RUN node db/setup.js

# Expose bot port
EXPOSE 3978

# Start the bot
CMD ["node", "index.js"]