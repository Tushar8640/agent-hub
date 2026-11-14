import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svgPath = path.resolve(__dirname, '../public/icon.svg');
const outDir = path.resolve(__dirname, '../public');

const svgBuffer = fs.readFileSync(svgPath);

// 1. icon-192.png
await sharp(svgBuffer)
  .resize(192, 192)
  .png()
  .toFile(path.join(outDir, 'icon-192.png'));

// 2. icon-512.png
await sharp(svgBuffer)
  .resize(512, 512)
  .png()
  .toFile(path.join(outDir, 'icon-512.png'));

// 3. icon-maskable-512.png (512x512, icon scaled to 80% = 410x410 centered on #0a0a0a background)
const icon410 = await sharp(svgBuffer)
  .resize(410, 410)
  .toBuffer();

await sharp({
  create: {
    width: 512,
    height: 512,
    channels: 4,
    background: '#0a0a0a',
  },
})
  .composite([{ input: icon410, gravity: 'center' }])
  .png()
  .toFile(path.join(outDir, 'icon-maskable-512.png'));

// 4. apple-touch-icon.png (180x180, icon scaled to 80% = 144x144 centered on #0a0a0a background)
const icon144 = await sharp(svgBuffer)
  .resize(144, 144)
  .toBuffer();

await sharp({
  create: {
    width: 180,
    height: 180,
    channels: 4,
    background: '#0a0a0a',
  },
})
  .composite([{ input: icon144, gravity: 'center' }])
  .png()
  .toFile(path.join(outDir, 'apple-touch-icon.png'));

console.log('PWA icons created successfully in web/public.');
