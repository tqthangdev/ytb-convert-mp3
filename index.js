const express = require('express');
const cors = require('cors');
const YTDLPWrap = require('yt-dlp-wrap').default;
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const http = require('http'); 
const { Server } = require('socket.io'); 

const app = express();
const PORT = process.env.PORT || 9999;

// Initialize HTTP server wrapped with Socket.io for real-time progress updates
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const isWindows = process.platform === 'win32';
const binaryPath = isWindows ? path.join(__dirname, 'yt-dlp.exe') : 'yt-dlp';
const ytdlpWrap = new YTDLPWrap(binaryPath);

app.use(cors());

async function initYtdlp() {
  if (isWindows) {
    if (!fs.existsSync(binaryPath)) {
      console.log('Windows detected. Fetching yt-dlp.exe...');
      await YTDLPWrap.downloadFromGithub(binaryPath);
    }
  } else {
    console.log('Linux detected. Using system yt-dlp.');
    try {
      const { execSync } = require('child_process');
      const denoVersion = execSync('deno --version').toString();
      console.log('Deno found:', denoVersion);
    } catch (e) {
      console.error('Deno NOT found! n-challenge will fail.');
    }
  }
}

// Listen for incoming socket connections from clients
io.on('connection', (socket) => {
  console.log(`Client connected via socket: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`Client disconnected socket: ${socket.id}`);
  });
});

app.get('/download', async (req, res) => {
  let tmpM4a = null;
  let tmpMp3 = null;
  const socketId = req.query.socketId; // Extract socketId passed from frontend

  // Modify the sendStatus utility inside app.get('/download') in index.js
  const sendStatus = (status, percent) => {
    if (socketId && io.to(socketId)) {
      // Fix: Include the requested url string context so the client separates multi-threaded states
      io.to(socketId).emit('progress_update', { status, percent, url: videoUrl });
    }
  };

  try {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).send('Missing URL parameter.');

    console.log(`Download request received for URL: ${videoUrl}`);
    sendStatus('fetching_info', 5); // Notify client that metadata extraction has started

    req.setTimeout(0);
    res.setTimeout(0);

    const cookiesPath = path.join(__dirname, 'cookies.txt');
    const cookieArgs = fs.existsSync(cookiesPath) ? ['--cookies', cookiesPath] : [];

    const ytdlpArgs = [
      '--js-runtimes', 'deno',
      '--remote-components', 'ejs:github',
    ];

    const info = await ytdlpWrap.getVideoInfo([
      videoUrl,
      ...ytdlpArgs,
      ...cookieArgs,
    ]);

    const safeTitle = (info.title || 'audio').replace(/[\\/:*?"<>|]/g, '');
    const timestamp = Date.now();

    tmpM4a = path.join('/tmp', `${timestamp}_${safeTitle}.m4a`);
    tmpMp3 = path.join('/tmp', `${timestamp}_${safeTitle}.mp3`);

    console.log(`Downloading audio source: ${safeTitle}`);
    sendStatus('downloading_server', 20); // Notify client that server download has started

    // Monitor yt-dlp download progress stream and map it to 20% -> 70% range
    let ytdlpEventEmitter = ytdlpWrap.exec([
      videoUrl,
      '-f', '140',
      '-o', tmpM4a,
      ...ytdlpArgs,
      ...cookieArgs,
    ])
    .on('progress', (progress) => {
       const currentPercent = 20 + Math.round((progress.percent || 0) * 0.5); 
       sendStatus('downloading_server', currentPercent);
    })
    .on('error', (err) => { throw err; });

    // Wait until the download stream completely closes
    await new Promise((resolve, reject) => {
       ytdlpEventEmitter.on('close', resolve);
       ytdlpEventEmitter.on('error', reject);
    });

    console.log('Download complete. Initiating FFmpeg conversion to MP3...');
    sendStatus('converting', 75); // Notify client that audio transcoding is in progress

    execSync(`ffmpeg -i "${tmpM4a}" -q:a 0 "${tmpMp3}"`);
    fs.unlinkSync(tmpM4a);
    tmpM4a = null;

    console.log('Transcoding complete. Ready to stream file back to client.');
    sendStatus('streaming', 90); // Notify client that file is ready to be delivered

    const stat = fs.statSync(tmpMp3);

    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeTitle)}.mp3`);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');

    const fileStream = fs.createReadStream(tmpMp3);
    fileStream.pipe(res);

    fileStream.on('end', () => {
      console.log('Streaming successfully completed. Cleaning up cache files...');
      sendStatus('completed', 100);
      fs.unlink(tmpMp3, () => {});
    });

    fileStream.on('error', (err) => {
      console.error('File stream error encountered:', err);
      fs.unlink(tmpMp3, () => {});
      if (!res.headersSent) res.status(500).send('Stream error.');
    });

  } catch (error) {
    console.error('Internal server exception occurred:', error);
    sendStatus('error', 0);
    if (tmpM4a) fs.unlink(tmpM4a, () => {});
    if (tmpMp3) fs.unlink(tmpMp3, () => {});
    if (!res.headersSent) res.status(500).send('Internal Server Error.');
  }
});

// Fix: Add a root route for environment wake-up pings
app.get('/', (req, res) => {
  console.log('Keep-alive ping received from client.');
  res.status(200).send('Server is alive and awake!');
});

initYtdlp().then(() => {
  // Use http server wrapper instance instead of original express app listener
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server successfully deployed and listening on port ${PORT}`);
  });
});