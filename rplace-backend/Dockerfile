# Use Node 18
FROM node:18

# Create app directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the app source code
COPY . .

# Expose port 7860 (Hugging Face specific port)
EXPOSE 7860

# Start the server
CMD [ "node", "server.js" ]