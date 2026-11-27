/**
 * admin/js/images.js — 올린 그림 확인 · 정리 · 썸네일 만들기
 *
 * 1) 확장자가 아니라 파일 앞부분(시그니처)으로 JPG·PNG·WEBP인지 확인
 * 2) 브라우저로 실제로 열어 그림이 맞는지 확인
 * 3) 가로 1200px 이하 JPG로 다시 저장 → 용량을 줄이고 그림 안에 숨은 다른 내용을 없앰
 * 서버(worker)도 저장 전에 같은 시그니처·용량 검사를 한 번 더 합니다.
 */

export const IMAGE_RULES = {
  maxBytes: 10 * 1024 * 1024,   // 올릴 수 있는 원본 크기
  minWidth: 800,                // DM 기준 폭(800)보다 작으면 흐려 보임
  backgroundWidth: 1200,        // 저장할 배경 폭 (DM 기준 폭의 1.5배)
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

/** 배경 그림: 검사 후 { blob, url(미리보기용), width, height } */
export async function prepareBackground(file) {
  if (file.size > IMAGE_RULES.maxBytes) throw new Error("그림 파일은 10MB 이하로 올려 주세요");
  if (!(await looksLikeImage(file))) throw new Error("JPG · PNG · WEBP 그림만 올릴 수 있어요");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("그림을 열 수 없어요. 다른 파일로 올려 주세요");
  }
  if (bitmap.width < IMAGE_RULES.minWidth) throw new Error(`가로 ${IMAGE_RULES.minWidth}px 이상인 그림을 올려 주세요`);
  const result = await toJpeg(bitmap, Math.min(bitmap.width, IMAGE_RULES.backgroundWidth));
  bitmap.close();
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
