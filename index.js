const express = require('express');
const cors = require('cors');
const { execStream, getVideoInfo } = require('yt-dlp-wrap'); // Dynamic wrap import
const YTDLPWrap = require('yt-dlp-wrap').default;
const path = require('path');
const fs = require('fs');

const app = express();
// Render assigns a dynamic port via process.env.PORT. Fallback to 9999 for local testing.
const PORT = process.env.PORT || 9999;

// Determine binary location: Render provides native global Linux 'yt-dlp' command if installed
const isWindows = process.platform === 'win32';
const binaryPath = isWindows ? path.join(__dirname, 'yt-dlp.exe') : 'yt-dlp'; 
const ytdlpWrap = new YTDLPWrap(binaryPath);

app.use(cors());

async function initYtdlp() {
  if (isWindows) {
    if (!fs.existsSync(binaryPath)) {
      console.log('Windows environment detected. Fetching yt-dlp.exe...');
      await YTDLPWrap.downloadFromGithub(binaryPath);
    }
  } else {
    // On Render Linux, we rely on the pre-installed global command or automated environment path
    console.log('Linux Cloud environment detected. Using system yt-dlp integration.');
  }
}

app.get('/download', async (req, res) => {
  try {
    const videoUrl = req.query.url;
    if (!videoUrl) {
      return res.status(400).send('Error: Missing URL parameter.');
    }

    console.log(`Cloud Server routing download request for: ${videoUrl}`);

    const cookiesPath = path.join(__dirname, 'cookies.txt');
    const cookieArgs = fs.existsSync(cookiesPath) ? ['--cookies', cookiesPath] : [];

    // 1. Fetch video details with stable browser-based web clients configuration
    const info = await ytdlpWrap.getVideoInfo([
      videoUrl,
      ...cookieArgs,
      '--extractor-args', 'youtube:player_client=web;player_skip=webpage'
    ]);
    
    // 2. Select best audio-only format stream
    // 🛠️ FIXED: Added a robust fallback to 'bestaudio' parameters if the explicit vcodec filter array returns empty
    let audioFormat = info.formats
      .filter(f => f.vcodec === 'none' && f.acodec !== 'none')
      .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

    let formatId = 'bestaudio/best';
    let sizeBytes = null;

    if (audioFormat) {
      formatId = audioFormat.format_id;
      sizeBytes = audioFormat.filesize || audioFormat.filesize_approx;
    } else {
      console.log('Explicit audio format not found. Falling back to global bestaudio selection.');
    }

    const videoTitle = info.title || 'downloaded_audio';
    const safeTitle = videoTitle.replace(/[\\/:*?"<>|]/g, '');

    if (sizeBytes) {
      res.setHeader('Content-Length', sizeBytes.toString());
    }

    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeTitle)}.mp3`);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Disposition');

    // 3. Stream the audio payload back to the React Native Client using the optimized formatId selection
    let ytdlpReadable = ytdlpWrap.execStream([
      videoUrl,
      '-f', formatId,
      ...cookieArgs,
      '--extractor-args', 'youtube:player_client=web;player_skip=webpage'
    ]);
    
    ytdlpReadable.pipe(res);

    ytdlpReadable.on('error', (err) => {
      console.error('Data stream pipe error:', err);
      if (!res.headersSent) res.status(500).send('Streaming error.');
    });

  } catch (error) {
    console.error('Render System Internal Error:', error);
    if (!res.headersSent) {
      res.status(500).send('Internal Server Error. Format extract pipeline failed.');
    }
  }
});

initYtdlp().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server successfully bound and listening on port ${PORT}`);
  });
});