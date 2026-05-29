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
    if (!videoUrl) return res.status(400).send('Missing URL');

    const cookiesPath = path.join(__dirname, 'cookies.txt');
    const cookieArgs = fs.existsSync(cookiesPath) ? ['--cookies', cookiesPath] : [];

    const info = await ytdlpWrap.getVideoInfo([
      videoUrl,
      ...cookieArgs,
      '--extractor-args', 'youtube:player_client=web;player_skip=webpage'
    ]);

    const safeTitle = (info.title || 'audio').replace(/[\\/:*?"<>|]/g, '');
    const tmpFile = path.join('/tmp', `${Date.now()}_${safeTitle}.mp3`);

    // Download vào file tạm
    await ytdlpWrap.execPromise([
      videoUrl,
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '-o', tmpFile,
      ...cookieArgs,
    ]);

    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeTitle)}.mp3`);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

    // Stream file tạm ra client rồi xóa
    const fileStream = fs.createReadStream(tmpFile);
    fileStream.pipe(res);
    fileStream.on('end', () => fs.unlink(tmpFile, () => {}));
    fileStream.on('error', (err) => {
      console.error('File stream error:', err);
      fs.unlink(tmpFile, () => {});
      if (!res.headersSent) res.status(500).send('Stream error');
    });

  } catch (error) {
    console.error('Error:', error);
    if (!res.headersSent) res.status(500).send('Internal Server Error');
  }
});

initYtdlp().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server successfully bound and listening on port ${PORT}`);
  });
});