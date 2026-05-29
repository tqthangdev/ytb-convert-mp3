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

    // 1. Fetch video details with extra flags to bypass bot challenges
    // 🛠️ UPDATED: Added '--extractor-args' to simulate an official mobile client platform extractor
    const info = await ytdlpWrap.getVideoInfo([
      videoUrl,
      '--extractor-args', 'youtube:player_client=android,ios;player_skip=webpage'
    ]);
    
    // 2. Select best audio-only format stream
    const audioFormat = info.formats
      .filter(f => f.vcodec === 'none' && f.acodec !== 'none')
      .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

    if (!audioFormat) {
      return res.status(404).send('Error: Playable audio format not found.');
    }

    const videoTitle = info.title || 'downloaded_audio';
    const safeTitle = videoTitle.replace(/[\\/:*?"<>|]/g, '');
    const sizeBytes = audioFormat.filesize || audioFormat.filesize_approx;

    if (sizeBytes) {
      res.setHeader('Content-Length', sizeBytes.toString());
    }

    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeTitle)}.mp3`);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Disposition');

    // 3. Spawn the streaming download processing pipeline with matching bypass args
    let ytdlpReadable = ytdlpWrap.execStream([
      videoUrl,
      '-f', audioFormat.format_id,
      '--extractor-args', 'youtube:player_client=android,ios;player_skip=webpage'
    ]);
    
    ytdlpReadable.pipe(res);

    ytdlpReadable.on('error', (err) => {
      console.error('Data stream pipe error:', err);
      if (!res.headersSent) res.status(500).send('Streaming error.');
    });

  } catch (error) {
    console.error('Render System Internal Error:', error);
    if (!res.headersSent) res.status(500).send('Internal Server Error.');
  }
});

initYtdlp().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server successfully bound and listening on port ${PORT}`);
  });
});