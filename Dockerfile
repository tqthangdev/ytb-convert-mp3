# 1. Use the official Node.js lightweight Alpine Linux image
FROM node:20-alpine

# 2. Install system dependencies required by yt-dlp (Python3, pip, and ffmpeg)
# 🛠️ FIXED: Added 'py3-pip' and explicitly run 'pip3 install' to place 'yt-dlp' globally in Linux PATH
RUN apk add --no-cache python3 py3-pip ffmpeg && \
    pip3 install --no-cache-dir --break-system-packages yt-dlp

# 3. Create and set the application working directory inside the container
WORKDIR /usr/src/app

# 4. Copy package manifests and install Node.js dependencies
COPY package*.json ./
RUN npm install

# 5. Copy the rest of the application source code
COPY . .

# 6. Expose the dynamic port used by Express framework binding
EXPOSE 9999

# 7. Start the application execution command
CMD [ "node", "index.js" ]