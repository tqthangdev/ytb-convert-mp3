const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const YTDLPWrap = require('yt-dlp-wrap').default;

const app = express();
// Render will automatically pass a dynamic port via process.env.PORT
const PORT = process.env.PORT || 9999;

// Determine binary name based on Operating System (Windows uses .exe, Linux does not)
const isWindows = process.platform === 'win32';
const binaryName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
const binaryPath = path.join(__dirname, binaryName);
const ytdlpWrap = new YTDLPWrap(binaryPath);

app.use(cors());

async function initYtdlp() {
  if (!fs.existsSync(binaryPath)) {
    console.log(`yt-dlp binary not found for ${process.platform}. Downloading automatically...`);
    try {
      // Automatically fetches the correct OS binary from GitHub releases
      await YTDLPWrap.downloadFromGithub(binaryPath);
      // On Linux/Render, we must explicitly grant execution permissions to the downloaded file
      if (!isWindows) {
        fs.chmodSync(binaryPath, '755');
      }
      console.log('yt-dlp binary downloaded and configured successfully!');
    } catch (err) {
      console.error('Failed to initialize yt-dlp binary:', err);
      process.exit(1);
    }
  } else {
    console.log('Validated local yt-dlp binary successfully.');
  }
}

app.get('/download', async (req, res) => {
  try {
    const videoUrl = req.query.url;

    if (!videoUrl) {
      return res.status(400).send('Error: Missing YouTube URL parameter.');
    }

    console.log(`Processing download request via yt-dlp-wrap for URL: ${videoUrl}`);

    // 1. Fetch video metadata format details using yt-dlp binary JSON extractor
    const info = await ytdlpWrap.getVideoInfo(videoUrl);
    
    // 2. Filter and select the highest available audio-only format stream
    const audioFormat = info.formats
      .filter(f => f.vcodec === 'none' && f.acodec !== 'none')
      .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

    if (!audioFormat) {
      return res.status(404).send('Error: Could not extract playable audio formats.');
    }

    // 3. Extract the clean video title and remove illegal filename characters if any
    const videoTitle = info.title || 'downloaded_audio';
    const safeTitle = videoTitle.replace(/[\\/:*?"<>|]/g, '');

    // 4. CRITICAL: Send Content-Length header so the mobile client can calculate progress percentage
    const sizeBytes = audioFormat.filesize || audioFormat.filesize_approx;
    if (sizeBytes) {
      res.setHeader('Content-Length', sizeBytes.toString());
    }

    // 5. CRITICAL: Pass the real video title to the client via Content-Disposition header encoded in UTF-8
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeTitle)}.mp3`);
    res.setHeader('Content-Type', 'audio/mpeg');
    
    // 6. CRITICAL: Expose Content-Length and Content-Disposition headers so client app can access them over the network
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Disposition');

    // 7. Execute yt-dlp process to stream the selected format binary directly to stdout
    let ytdlpReadable = ytdlpWrap.execStream([
      videoUrl,
      '-f',
      audioFormat.format_id
    ]);

    ytdlpReadable.pipe(res);

    ytdlpReadable.on('error', (err) => {
      console.error('Streaming stream error:', err);
      if (!res.headersSent) {
        res.status(500).send('Streaming error occurred during data piping.');
      }
    });

  } catch (error) {
    console.error('Server Internal Error:', error);
    if (!res.headersSent) {
      res.status(500).send('Internal Server Error. Please verify the YouTube video link.');
    }
  }
});

initYtdlp().then(() => {
  // Listen on 0.0.0.0 to allow cloud hosting routing bindings
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
  });
});