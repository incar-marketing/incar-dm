/**
 * renderer.js — DM을 캔버스에 그립니다.
 * 미리보기와 PNG 저장이 이 함수 하나를 함께 쓰기 때문에, 화면과 저장 파일이 항상 같습니다.
 *
 * 그리는 순서: 배경 이미지(고정 문구 포함) → 바뀌는 글자(texts) → 회사 로고
 */
import { assetUrl } from "./templates.js?v=20261127d";

/** DM 안에 들어가는 회사 로고 모양. car = 로고 그림 안 'CAR' 글자의 위·아래 위치(px) */
export const LOGO_SHAPES = [
  { id: "h", label: "가로형", w: 600, h: 85, car: [22, 68] },
  { id: "brand", label: "브랜드철학", w: 497, h: 202, car: [50, 153] },
  { id: "stack", label: "국문조합", w: 497, h: 262, car: [50, 154], kosdaqMiddle: true },
  { id: "sig", label: "심볼만", w: 496, h: 192, car: [50, 154] }
];
const KOSDAQ = { src: "assets/images/logo/kosdaq.png", w: 82, h: 29 };

const FONT_FAMILY = {
  buri: '"buri", "Noto Serif KR", serif',
  dotum: '"dotum", "Malgun Gothic", sans-serif',
  script: '"Pinyon Script", "Times New Roman", serif',
  suit: '"SUIT", sans-serif'   // 고딕 (굵기 400/700/800)
};
const PLACEHOLDER = "rgba(255, 214, 0, 0.65)";
const TOKEN = /\{(\w+)\}/g;

/* 같은 이미지를 두 번 받지 않도록 기억 */
const imageCache = new Map();
export function loadImage(src) {
  if (!imageCache.has(src)) {
    imageCache.set(src, new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => { imageCache.delete(src); reject(new Error(`이미지를 불러오지 못했어요: ${src}`)); };
      image.src = src;
    }));
  }
  return imageCache.get(src);
}

const fontSpec = (item, size) => `${item.weight || 400} ${size}px ${FONT_FAMILY[item.font]}`;

async function fontsReady(template) {
  const specs = new Set(template.texts.map(item => fontSpec(item, item.size)));
  try {
    await Promise.all([...specs].map(spec => document.fonts.load(spec, "가나다 Financial 0123")));
  } catch {
    /* 글꼴을 못 받아도 기본 글꼴로 그립니다 */
  }
}

/** "{customerName} 고객님께" → [{token:"customerName", text:"이윤서"}, {text:" 고객님께"}] */
function splitText(text, values) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ token: match[1], text: values[match[1]] || "" });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

function drawText(ctx, item, values, { preview, placeholders }) {
  const parts = splitText(item.text, values).map(part =>
    part.token && !part.text && preview ? { ...part, text: placeholders[part.token] || part.token, empty: true } : part);
  let size = item.size;
  const spacing = item.letterSpacing || 0;
  const measure = () => {
    ctx.font = fontSpec(item, size);
    return parts.map(part => ctx.measureText(part.text).width + spacing * [...part.text].length);
  };
  let widths = measure();
  let total = widths.reduce((a, b) => a + b, 0);
  // 이름이 길어 자리를 넘치면 글자 크기를 줄입니다
  if (item.maxWidth && total > item.maxWidth) {
    size = Math.max(10, Math.floor(size * item.maxWidth / total));
    widths = measure();
    total = widths.reduce((a, b) => a + b, 0);
  }
  let x = item.align === "center" ? item.x - total / 2 : item.align === "right" ? item.x - total : item.x;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${spacing}px`;
  parts.forEach((part, i) => {
    if (preview && part.empty) {
      ctx.fillStyle = PLACEHOLDER;
      ctx.fillRect(x - 2, item.y - size * 0.62, widths[i] + 4, size * 1.24);
    }
    ctx.fillStyle = item.color || "#000";
    ctx.fillText(part.text, x, item.y);
    x += widths[i];
  });
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
}

async function drawLogo(ctx, logo, shapeId) {
  const shape = LOGO_SHAPES.find(s => s.id === shapeId) || LOGO_SHAPES[0];
  const carHeight = shape.car[1] - shape.car[0];
  // 묶음 폭 = 로고 + 간격 + KOSDAQ 마크(높이를 'CAR' 글자와 같게)
  const kosdaqWidth = logo.kosdaq ? carHeight * KOSDAQ.w / KOSDAQ.h : 0;
  const gap = logo.kosdaq ? carHeight * 0.3 : 0;
  const scale = Math.min(logo.h / shape.h, logo.w / (shape.w + gap + kosdaqWidth));
  const groupWidth = (shape.w + gap + kosdaqWidth) * scale;
  const logoHeight = shape.h * scale;
  const x = logo.align === "left" ? logo.x : logo.align === "center" ? logo.x + (logo.w - groupWidth) / 2 : logo.x + logo.w - groupWidth;
  const y = logo.valign === "top" ? logo.y : logo.valign === "middle" ? logo.y + (logo.h - logoHeight) / 2 : logo.y + logo.h - logoHeight;
  const [logoImage, kosdaqImage] = await Promise.all([
    loadImage(`assets/images/logo/${logo.color || "blue"}/${shape.id}.png`),
    logo.kosdaq ? loadImage(KOSDAQ.src) : null
  ]);
  ctx.drawImage(logoImage, x, y, shape.w * scale, logoHeight);
  if (kosdaqImage) {
    const ky = shape.kosdaqMiddle ? y + (logoHeight - carHeight * scale) / 2 : y + shape.car[0] * scale;
    ctx.drawImage(kosdaqImage, x + (shape.w + gap) * scale, ky, kosdaqWidth * scale, carHeight * scale);
  }
}

/**
 * DM 한 장을 canvas 에 그립니다.
 * @param {HTMLCanvasElement} canvas
 * @param {object} template  templates.js 가 불러온 템플릿
 * @param {object} values    { customerName, agentName, agentPhone }
 * @param {object} options   { background, logo, scale, preview, placeholders }
 */
export async function renderDM(canvas, template, values, options) {
  const background = template.backgrounds.find(bg => bg.id === options.background) || template.backgrounds[0];
  // background.src: 관리자 페이지에서 아직 저장 전인 그림을 미리 볼 때만 씁니다 (template.json 에는 저장되지 않음)
  const [bgImage] = await Promise.all([loadImage(background.src || assetUrl(template, background.file)), fontsReady(template)]);
  const { width, height } = template.size;
  const scale = options.scale || bgImage.naturalWidth / width;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bgImage, 0, 0, width, height);
  for (const item of template.texts) drawText(ctx, item, values, options);
  if (template.logo) await drawLogo(ctx, template.logo, options.logo);
  return canvas;
}

export async function renderToBlob(template, values, options) {
  const canvas = await renderDM(document.createElement("canvas"), template, values, { ...options, preview: false });
  return new Promise((resolve, reject) =>
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error("이미지를 만들지 못했어요"))), "image/jpeg", 0.92));
}
