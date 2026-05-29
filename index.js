const express = require('express');
const cors = require('cors');
const YTDLPWrap = require('yt-dlp-wrap').default;
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 9999;

// Use .exe on Windows, rely on global binary on Linux (Render)
const isWindows = process.platform === 'win32';
const binaryPath = isWindows ? path.join(__dirname, 'yt-dlp.exe') : 'yt-dlp';
const ytdlpWrap = new YTDLPWrap(binaryPath);

app.use(cors());

// Download yt-dlp binary on Windows if not present; Linux uses system-installed binary
async function initYtdlp() {
  if (isWindows) {
    if (!fs.existsSync(binaryPath)) {
      console.log('Windows detected. Fetching yt-dlp.exe...');
      await YTDLPWrap.downloadFromGithub(binaryPath);
    }
  } else {
    console.log('Linux detected. Using system yt-dlp.');
  }
}

app.get('/download', async (req, res) => {
  let tmpM4a = null;
  let tmpMp3 = null;

  try {
    const videoUrl = req.query.url;
    if (!videoUrl) {
      return res.status(400).send('Error: Missing URL parameter.');
    }

    console.log(`Download request for: ${videoUrl}`);

    // Attach cookies if available (helps bypass age-restricted or region-locked videos)
    const cookiesPath = path.join(__dirname, 'cookies.txt');
    const cookieArgs = fs.existsSync(cookiesPath) ? ['--cookies', cookiesPath] : [];

    // Step 1: Fetch video metadata to get the title
    const info = await ytdlpWrap.getVideoInfo([
      videoUrl,
      ...cookieArgs,
    ]);

    const videoTitle = info.title || 'downloaded_audio';

    // Sanitize title to be safe for use as a filename
    const safeTitle = videoTitle.replace(/[\\/:*?"<>|]/g, '');
    const timestamp = Date.now();

    // Define temp file paths for intermediate m4a and final mp3
    tmpM4a = path.join('/tmp', `${timestamp}_${safeTitle}.m4a`);
    tmpMp3 = path.join('/tmp', `${timestamp}_${safeTitle}.mp3`);

    console.log(`Downloading: ${safeTitle}`);

    // Step 2: Download format 140 (m4a, 129k) — always available on YouTube
    // Avoids JS runtime dependency that causes "format not available" errors
    await ytdlpWrap.execPromise([
      videoUrl,
      '-f', '140',
      '-o', tmpM4a,
      ...cookieArgs,
    ]);

    console.log('Download complete. Converting to mp3...');

    // Step 3: Convert m4a to mp3 using ffmpeg, then remove the m4a temp file
    execSync(`ffmpeg -i "${tmpM4a}" -q:a 0 "${tmpMp3}"`);
    fs.unlinkSync(tmpM4a);
    tmpM4a = null;

    console.log('Conversion complete. Streaming mp3...');

    // Step 4: Set response headers and stream the mp3 file to the client
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeTitle)}.mp3`);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    const fileStream = fs.createReadStream(tmpMp3);
    fileStream.pipe(res);

    // Cleanup mp3 temp file after streaming finishes
    fileStream.on('end', () => {
      console.log('Stream complete. Cleaning up...');
      fs.unlink(tmpMp3, () => {});
    });

    // Handle stream errors and cleanup
    fileStream.on('error', (err) => {
      console.error('File stream error:', err);
      fs.unlink(tmpMp3, () => {});
      if (!res.headersSent) res.status(500).send('Stream error.');
    });

  } catch (error) {
    console.error('Internal error:', error);

    // Clean up any leftover temp files on failure
    if (tmpM4a) fs.unlink(tmpM4a, () => {});
    if (tmpMp3) fs.unlink(tmpMp3, () => {});

    if (!res.headersSent) {
      res.status(500).send('Internal Server Error.');
    }
  }
});

initYtdlp().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
  });
});