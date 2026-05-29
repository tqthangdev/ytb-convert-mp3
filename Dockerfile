# 1. Use the official Node.js lightweight Alpine Linux image
FROM node:20-alpine

# 2. Install system dependencies, ffmpeg, yt-dlp, and deno (required for yt-dlp n-challenge solving)
RUN apk add --no-cache python3 py3-pip ffmpeg curl unzip && \
    pip3 install --no-cache-dir --upgrade --break-system-packages yt-dlp && \
    curl -fsSL https://deno.land/install.sh | sh

# 3. Add deno to PATH so yt-dlp can find it at runtime
ENV DENO_INSTALL="/root/.deno"
ENV PATH="${DENO_INSTALL}/bin:${PATH}"

# 4. Create and set the application working directory inside the container
WORKDIR /usr/src/app

# 5. Copy package manifests and install Node.js dependencies
COPY package*.json ./
RUN npm install

# 6. Copy the rest of the application source code
COPY . .

# 7. Expose the dynamic port used by Express framework binding
EXPOSE 9999

# 8. Start the application execution command
CMD [ "node", "index.js" ]