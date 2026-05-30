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

// Replace the internal logic of app.get('/download') inside index.js
app.get('/download', async (req, res) => {
  let tmpM4a = null;
  let tmpMp3 = null;
  const socketId = req.query.socketId; 
  let videoUrl = req.query.url; // Use let instead of const to allow mutations

  const sendStatus = (status, percent) => {
    if (socketId && io.to(socketId)) {
      io.to(socketId).emit('progress_update', { status, percent, url: req.query.url });
    }
  };

  try {
    if (!videoUrl) return res.status(400).send('Missing URL parameter.');

    // Fix: Normalize short links (youtu.be) and remove analytic query parameters (?si=...)
    videoUrl = videoUrl.trim();
    if (videoUrl.includes('youtu.be/')) {
      const videoId = videoUrl.split('youtu.be/')[1].split('?')[0];
      videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    } else if (videoUrl.includes('watch?v=')) {
      const urlObj = new URL(videoUrl);
      const videoId = urlObj.searchParams.get('v');
      videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    }

    console.log(`Processing normalized target URL: ${videoUrl}`);
    sendStatus('fetching_info', 5); 

    req.setTimeout(0);
    res.setTimeout(0);

    const cookiesPath = path.join(__dirname, 'cookies.txt');
    const cookieArgs = fs.existsSync(cookiesPath) ? ['--cookies', cookiesPath] : [];

    const ytdlpArgs = [
      '--js-runtimes', 'deno',
      '--remote-components', 'ejs:github',
      '--no-check-certificates', // Bypass SSL verification drops if any on cloud containers
    ];

    // Fetch video info metadata
    let info;
    try {
      info = await ytdlpWrap.getVideoInfo([
        videoUrl,
        ...ytdlpArgs,
        ...cookieArgs,
      ]);
    } catch (infoError) {
      console.error('Failed to extract video metadata info:', infoError.message);
      // Return detail back to response stream for precise mobile alert messaging
      return res.status(500).send(`Metadata failure: ${infoError.message}`);
    }

    const safeTitle = (info.title || 'audio').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
    const timestamp = Date.now();

    tmpM4a = path.join('/tmp', `${timestamp}_${safeTitle}.m4a`);
    tmpMp3 = path.join('/tmp', `${timestamp}_${safeTitle}.mp3`);

    console.log(`Downloading audio source payload to: ${tmpM4a}`);
    sendStatus('downloading_server', 20); 

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
    .on('error', (err) => { 
      console.error('Ytdlp download binary stream process error:', err.message);
    });

    await new Promise((resolve, reject) => {
       ytdlpEventEmitter.on('close', resolve);
       ytdlpEventEmitter.on('error', reject);
    });

    if (!fs.existsSync(tmpM4a)) {
      throw new Error('Source file .m4a was not created by yt-dlp binary');
    }

    console.log('Download complete. Initiating FFmpeg conversion to MP3...');
    sendStatus('converting', 75); 

    try {
      execSync(`ffmpeg -y -i "${tmpM4a}" -q:a 0 "${tmpMp3}"`);
    } catch (ffmpegError) {
      console.error('FFmpeg transformation compilation failure:', ffmpegError.message);
      throw ffmpegError;
    }

    if (fs.existsSync(tmpM4a)) fs.unlinkSync(tmpM4a);
    tmpM4a = null;

    console.log('Transcoding complete. Ready to stream file back to client.');
    sendStatus('streaming', 90); 

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
      if (tmpMp3 && fs.existsSync(tmpMp3)) fs.unlink(tmpMp3, () => {});
    });

    fileStream.on('error', (err) => {
      console.error('File stream error encountered:', err.message);
      if (tmpMp3 && fs.existsSync(tmpMp3)) fs.unlink(tmpMp3, () => {});
      if (!res.headersSent) res.status(500).send('Stream transfer error.');
    });

  } catch (error) {
    console.error('Internal server exception occurred:', error.message);
    sendStatus('error', 0);
    if (tmpM4a && fs.existsSync(tmpM4a)) fs.unlink(tmpM4a, () => {});
    if (tmpMp3 && fs.existsSync(tmpMp3)) fs.unlink(tmpMp3, () => {});
    if (!res.headersSent) res.status(500).send(`Internal Error: ${error.message}`);
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