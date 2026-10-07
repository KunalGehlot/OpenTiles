// Renders the PNG app icons in public/ from public/icon.svg with Playwright's Chromium.
// Run after changing the logo: `pnpm --filter @opentiles/web icons`
// (set PW_CHROMIUM_PATH to use a preinstalled Chromium). The PNGs are committed.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const publicDir = resolve(import.meta.dirname, '../public');
const svg = readFileSync(resolve(publicDir, 'icon.svg'), 'utf8');
const BACKGROUND = '#1f6f5c';

/** The logo's artwork (everything inside the root <svg>, minus its rounded background tile). */
const artwork = svg
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<rect width="64" height="64"[^>]*\/>/, '');

/**
 * A square, full-bleed variant: iOS fills transparent pixels of an apple-touch-icon with black and
 * rounds the corners itself, and maskable icons are cropped by the platform. `scale` shrinks the
 * artwork around the centre to keep it inside the crop (the maskable safe zone is a circle of 40 %
 * of the icon size).
 */
function fullBleed(scale) {
  const offset = 32 * (1 - scale);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="${BACKGROUND}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">${artwork}</g>
</svg>`;
}

const outputs = [
  // Android and desktop install icons keep the rounded tile and its transparent corners.
  { file: 'pwa-192x192.png', size: 192, source: svg },
  { file: 'pwa-512x512.png', size: 512, source: svg },
  { file: 'maskable-512x512.png', size: 512, source: fullBleed(0.8) },
  { file: 'apple-touch-icon.png', size: 180, source: fullBleed(0.9) },
];

const browser = await chromium.launch(
  process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
);
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const { file, size, source } of outputs) {
    await page.setViewportSize({ width: size, height: size });
    const sized = source.replace('<svg ', `<svg width="${size}" height="${size}" `);
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">${sized}</body></html>`,
    );
    await page.screenshot({
      path: resolve(publicDir, file),
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    console.log(`public/${file} (${size}×${size})`);
  }
} finally {
  await browser.close();
}
