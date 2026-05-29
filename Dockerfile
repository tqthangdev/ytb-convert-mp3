# 1. Use Debian-based Node.js image (has glibc, compatible with deno binary)
FROM node:20-slim

# 2. Install system dependencies, ffmpeg, yt-dlp
RUN apt-get update && apt-get install -y \
    python3 python3-pip ffmpeg curl unzip && \
    pip3 install --no-cache-dir --upgrade --break-system-packages yt-dlp

# 3. Install deno (glibc compatible)
RUN curl -fsSL https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip \
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