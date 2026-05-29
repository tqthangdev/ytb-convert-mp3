# 1. Use the official Node.js lightweight Alpine Linux image
FROM node:20-alpine

# 2. Install system dependencies, ffmpeg, yt-dlp
RUN apk add --no-cache python3 py3-pip ffmpeg curl unzip && \
    pip3 install --no-cache-dir --upgrade --break-system-packages yt-dlp

# 3. Install deno (Alpine/musl compatible binary)
RUN curl -fsSL https://github.com/denoland/deno/releases/download/v2.3.3/deno-x86_64-unknown-linux-musl.zip \
    -o /tmp/deno.zip && \
    unzip /tmp/deno.zip -d /usr/local/bin && \
    chmod +x /usr/local/bin/deno && \
    rm /tmp/deno.zip

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