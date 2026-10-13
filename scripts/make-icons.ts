/**
 * PWA 아이콘 PNG 만들기 (public/icons/icon.svg → 192·512·maskable·apple-touch)
 * 실행: npx tsx scripts/make-icons.ts  (Playwright Chromium 으로 SVG 를 그려 저장)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const dir = path.join(process.cwd(), "public", "icons");
const svg = readFileSync(path.join(dir, "icon.svg"), "utf8");
// 마스커블: 바깥 20% 는 잘릴 수 있으므로 배경을 꽉 채우고 그림을 안쪽으로 줄인다
const maskable = svg.replace('rx="112"', 'rx="0"').replace("<g ", '<g transform="translate(51 51) scale(.8)" ').replace("<rect x=", '<rect transform="translate(51 51) scale(.8)" x=');
// 애플 아이콘: iOS 가 모서리를 직접 둥글게 하므로 사각형으로
const apple = svg.replace('rx="112"', 'rx="0"');

const outputs: { file: string; size: number; svg: string }[] = [
  { file: "icon-192.png", size: 192, svg },
  { file: "icon-512.png", size: 512, svg },
  { file: "maskable-512.png", size: 512, svg: maskable },
  { file: "apple-touch-icon.png", size: 180, svg: apple },
  { file: "favicon-32.png", size: 32, svg },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const o of outputs) {
  await page.setViewportSize({ width: o.size, height: o.size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${o.svg.replace("<svg ", `<svg width="${o.size}" height="${o.size}" `)}</body></html>`);
  await page.screenshot({ path: path.join(dir, o.file), omitBackground: true, clip: { x: 0, y: 0, width: o.size, height: o.size } });
  console.log(o.file);
}
await browser.close();
