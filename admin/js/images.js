/**
 * admin/js/images.js — 올린 그림 확인 · 정리 · 썸네일 만들기
 *
 * 1) 확장자가 아니라 파일 앞부분(시그니처)으로 JPG·PNG·WEBP인지 확인
 * 2) 브라우저로 실제로 열어 그림이 맞는지 확인
 * 3) 가로 1000px 이하 JPG로 다시 저장 → 용량을 줄이고 그림 안에 숨은 다른 내용을 없앰
 * 서버(worker)도 저장 전에 같은 시그니처·용량 검사를 한 번 더 합니다.
 */

export const IMAGE_RULES = {
  maxBytes: 50 * 1024 * 1024,   // 올릴 수 있는 원본 크기 (올린 뒤 가로 1000px 이하 JPG로 줄여 저장)
  sharpWidth: 800,              // 이보다 작으면 저장되는 DM이 흐려 보일 수 있어 안내만 함 (막지 않음)
  backgroundWidth: 1000,        // 저장할 배경 폭 (DM 기준 폭의 1.25배, 2026-11-27 과장님 요청으로 1200→1000)
  thumbnailWidth: 360,          // 목록 카드용
  quality: 0.85
};

const SIGNATURES = [[0xff, 0xd8, 0xff], [0x89, 0x50, 0x4e, 0x47], [0x52, 0x49, 0x46, 0x46]]; // JPG, PNG, WEBP(RIFF)

async function looksLikeImage(file) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return SIGNATURES.some(signature => signature.every((byte, i) => head[i] === byte));
}

/** canvas → JPG (투명한 부분은 흰색) */
function toJpeg(source, width) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round(source.height * width / source.width);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob(blob =>
    (blob ? resolve({ blob, width: canvas.width, height: canvas.height }) : reject(new Error("그림을 만들지 못했어요"))),
  "image/jpeg", IMAGE_RULES.quality));
}

/** 배경 그림: 검사 후 { blob, url(미리보기용), width, height, ratio(원본 세로/가로) } */
export async function prepareBackground(file) {
  if (file.size > IMAGE_RULES.maxBytes) throw new Error("그림 파일은 50MB 이하로 올려 주세요");
  if (!(await looksLikeImage(file))) throw new Error("JPG · PNG · WEBP 그림만 올릴 수 있어요");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("그림을 열 수 없어요. 다른 파일로 올려 주세요");
  }
  const ratio = bitmap.height / bitmap.width;   // 줄이기 전 원본 비율 (줄인 크기는 반올림돼 1px 어긋날 수 있음)
  const result = await toJpeg(bitmap, Math.min(bitmap.width, IMAGE_RULES.backgroundWidth));
  bitmap.close();
  return { ...result, ratio, url: URL.createObjectURL(result.blob) };
}

/**
 * 배경 그림에 찍힌 표시 글자({고객명} 등)를 지웁니다. (PPT를 그대로 내보낸 그림을 올렸을 때)
 * 표시 글자 폭만큼의 띠를, 띠 바로 왼쪽·오른쪽 색을 가로로 이어 칠해 채웁니다.
 * 단색·그라데이션 배경에서는 자연스럽고, 사진·무늬 위라면 티가 나므로 관리자 화면에서 끌 수 있습니다.
 * @param {Blob} source  배경 그림
 * @param {Array} marks  pptx.js 가 읽은 표시 자리 { text, x, y, size, align, weight, maxWidth } (DM 가로 800 기준)
 */
export async function eraseMarks(source, marks, dmWidth) {
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const scale = canvas.width / dmWidth;
  const STRIP = 4;   // 가장자리에서 색을 따올 두께(px)
  const median = values => values.sort((a, b) => a - b)[values.length >> 1];
  /** (x,y)부터 w×h 칸에서, 가로줄(byRow) 또는 세로줄마다 대표 색 [r,g,b] (중앙값이라 눈송이 같은 점은 무시됨) */
  const edgeColors = (x, y, w, h, byRow) => {
    x = Math.max(0, Math.min(canvas.width - w, x));
    y = Math.max(0, Math.min(canvas.height - h, y));
    const data = ctx.getImageData(x, y, w, h).data;
    const lines = byRow ? h : w, depth = byRow ? w : h;
    return Array.from({ length: lines }, (_, line) => [0, 1, 2].map(ch => median(Array.from({ length: depth }, (_, d) =>
      data[((byRow ? line * w + d : d * w + line)) * 4 + ch]))));
  };
  const mismatch = (a, b) => a.reduce((sum, color, i) => sum + Math.abs(color[0] - b[i][0]) + Math.abs(color[1] - b[i][1]) + Math.abs(color[2] - b[i][2]), 0) / a.length;

  for (const mark of marks) {
    // 표시 글자 폭: 사이트 글꼴로 재고 PPT 글꼴 차이만큼 여유를 둡니다 (글상자 폭을 넘지 않게)
    ctx.font = `${mark.weight} ${mark.size}px "SUIT", sans-serif`;
    const width = Math.min(ctx.measureText(mark.text).width * 1.15 + mark.size * 0.4, mark.maxWidth + mark.size * 0.4);
    const left = mark.align === "center" ? mark.x - width / 2 : mark.align === "right" ? mark.x - width + mark.size * 0.2 : mark.x - mark.size * 0.2;
    const x0 = Math.max(0, Math.floor(left * scale)), x1 = Math.min(canvas.width, Math.ceil((left + width) * scale));
    const y0 = Math.max(0, Math.floor((mark.y - mark.size * 0.7) * scale)), y1 = Math.min(canvas.height, Math.ceil((mark.y + mark.size * 0.7) * scale));
    const w = x1 - x0, h = y1 - y0;
    if (w < 2 || h < 2) continue;
    // 양옆 색으로 가로 채우기 vs 위아래 색으로 세로 채우기 — 두 가장자리 색이 더 비슷한 쪽을 씁니다
    // (글자가 카드 경계에 걸쳐 있으면 세로, 띠 모양 위에 있으면 가로가 자연스럽습니다)
    const leftSide = edgeColors(x0 - STRIP, y0, STRIP, h, true), rightSide = edgeColors(x1, y0, STRIP, h, true);
    const topSide = edgeColors(x0, y0 - STRIP, w, STRIP, false), bottomSide = edgeColors(x0, y1, w, STRIP, false);
    const horizontal = mismatch(leftSide, rightSide) <= mismatch(topSide, bottomSide);
    const patch = ctx.createImageData(w, h);
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const [from, to, t] = horizontal ? [leftSide[row], rightSide[row], (col + 0.5) / w] : [topSide[col], bottomSide[col], (row + 0.5) / h];
        const at = (row * w + col) * 4;
        for (let ch = 0; ch < 3; ch++) patch.data[at + ch] = from[ch] * (1 - t) + to[ch] * t;
        patch.data[at + 3] = 255;
      }
    }
    ctx.putImageData(patch, x0, y0);
  }
  const result = await toJpeg(canvas, canvas.width);
  return { ...result, url: URL.createObjectURL(result.blob) };
}

/** 완성된 DM canvas → 목록용 작은 그림 */
export const makeThumbnail = canvas => toJpeg(canvas, IMAGE_RULES.thumbnailWidth).then(result => result.blob);

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("파일을 읽지 못했어요"));
    reader.readAsDataURL(blob);
  });
}
