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
    // Check deno is available
    try {
      const { execSync } = require('child_process');
      const denoVersion = execSync('deno --version').toString();
      console.log('Deno found:', denoVersion);
    } catch (e) {
      console.error('Deno NOT found! n-challenge will fail.');
    }
  }
}

app.get('/download', async (req, res) => {
  let tmpM4a = null;
  let tmpMp3 = null;

  try {
    const videoUrl = req.query.url;
    if (!videoUrl) return res.status(400).send('Missing URL parameter.');

    console.log(`Download request for: ${videoUrl}`);

    // Keep connection alive to prevent 502 timeout during processing
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

    console.log(`Downloading: ${safeTitle}`);

    await ytdlpWrap.execPromise([
      videoUrl,
      '-f', '140',
      '-o', tmpM4a,
      ...ytdlpArgs,
      ...cookieArgs,
    ]);

    console.log('Download done. Converting to mp3...');
    execSync(`ffmpeg -i "${tmpM4a}" -q:a 0 "${tmpMp3}"`);
    fs.unlinkSync(tmpM4a);
    tmpM4a = null;

    console.log('Conversion done. Streaming...');

    const stat = fs.statSync(tmpMp3);

    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeTitle)}.mp3`);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');

    const fileStream = fs.createReadStream(tmpMp3);
    fileStream.pipe(res);

    fileStream.on('end', () => {
      console.log('Stream complete. Cleaning up...');
      fs.unlink(tmpMp3, () => {});
    });

    fileStream.on('error', (err) => {
      console.error('File stream error:', err);
      fs.unlink(tmpMp3, () => {});
      if (!res.headersSent) res.status(500).send('Stream error.');
    });

  } catch (error) {
    console.error('Internal error:', error);
    if (tmpM4a) fs.unlink(tmpM4a, () => {});
    if (tmpMp3) fs.unlink(tmpMp3, () => {});
    if (!res.headersSent) res.status(500).send('Internal Server Error.');
  }
});

initYtdlp().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
  });
});