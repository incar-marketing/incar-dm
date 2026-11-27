/**
 * download.js — 파일 만들기와 내려받기
 *  - PNG: renderer.js 로 그린 그림
 *  - PPT: 템플릿 폴더의 PPT 파일 안 {고객명}·{설계사명}·{연락처}를 바꿔서
 *  - 여러 명: 휴대폰은 공유창, PC는 zip 파일 하나로
 * 외부 라이브러리 없이 브라우저 기본 기능만 씁니다.
 */
import { assetUrl, PPT_TOKENS } from "./templates.js?v=20261127h";
import { renderToBlob } from "./renderer.js?v=20261127h";

/* ---------- zip 읽기·쓰기 (PPT 파일도 zip 구조입니다) ---------- */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 압축하지 않고 묶는 zip (그림·PPT 안 그림은 이미 압축돼 있어 크기 차이가 거의 없습니다) */
export function makeZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = file.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);            // 파일 이름을 UTF-8 로 (한글 이름)
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(local, name, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(entry, name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, end], { type: "application/zip" });
}

const canInflate = typeof DecompressionStream === "function";

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** zip(=PPT) 안 파일 목록 읽기 — 관리자 페이지의 PPT 글자 자리 읽기에서도 씁니다 */
export async function readZip(buffer) {
  const view = new DataView(buffer);
  let eocd = buffer.byteLength - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("PPT 파일 형식이 아니에요");
  const count = view.getUint16(eocd + 10, true);
  let pointer = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const files = [];
  for (let i = 0; i < count; i++) {
    const method = view.getUint16(pointer + 10, true);
    const compressedSize = view.getUint32(pointer + 20, true);
    const nameLength = view.getUint16(pointer + 28, true);
    const extraLength = view.getUint16(pointer + 30, true);
    const commentLength = view.getUint16(pointer + 32, true);
    const localOffset = view.getUint32(pointer + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, pointer + 46, nameLength));
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const raw = new Uint8Array(buffer, dataStart, compressedSize);
    files.push({ name, data: method === 0 ? raw.slice() : await inflate(raw) });
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const escapeXml = value => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

/**
 * 슬라이드 글자 안의 표시를 바꿉니다.
 * PowerPoint 는 한 단어를 여러 조각(<a:r>)으로 나눠 저장하기도 해서, 문단 단위로 이어 붙여 찾습니다.
 */
function fillSlideXml(xml, replacements) {
  let found = 0;
  // 긴 표시부터 한 번에 찾아 바꿉니다 (바꾼 글자를 다시 바꾸는 일이 없도록)
  const keys = Object.keys(replacements).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  const filled = xml.replace(/<a:p>[\s\S]*?<\/a:p>/g, paragraph => {
    const runs = [...paragraph.matchAll(/(<a:t(?:\s[^>]*)?>)([\s\S]*?)(<\/a:t>)/g)];
    const joined = runs.map(run => run[2]).join("");
    if (!Object.keys(replacements).some(token => joined.includes(token))) return paragraph;
    const text = joined.replace(pattern, token => { found++; return escapeXml(replacements[token]); });
    let index = 0;
    return paragraph.replace(/(<a:t(?:\s[^>]*)?>)([\s\S]*?)(<\/a:t>)/g, (_, open, __, close) =>
      `${open}${index++ === 0 ? text : ""}${close}`);
  });
  return { xml: filled, found };
}

/**
 * PPT 원본을 불러옵니다.
 * GitHub Pages 에서는 .pptx 를 그대로 읽고, Claude 미리보기처럼 .pptx 를 올릴 수 없는 곳에서는
 * 같은 이름 뒤에 .b64.txt 가 붙은 글자 파일(base64)을 대신 읽습니다.
 */
async function loadPptFile(url) {
  const isZip = buffer => buffer.byteLength > 4 && new Uint8Array(buffer, 0, 2).every((b, i) => b === [0x50, 0x4b][i]);
  const direct = await fetch(url, { cache: "no-cache" }).catch(() => null);
  if (direct?.ok) {
    const buffer = await direct.arrayBuffer();
    if (isZip(buffer)) return buffer;
  }
  const backup = await fetch(`${url}.b64.txt`).catch(() => null);
  if (backup?.ok) {
    const binary = atob((await backup.text()).trim());
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    if (isZip(bytes.buffer)) return bytes.buffer;
  }
  throw new Error("PPT 파일을 찾을 수 없어요");
}

/** PPT 안에서 바꿀 글자: 기본 표시({고객명} 등) + 템플릿마다 정한 글자(예: OOO) */
function pptReplacements(template, values) {
  const fill = text => text.replace(/\{(\w+)\}/g, (_, key) => values[key] || "");
  const map = {};
  for (const [key, token] of Object.entries(PPT_TOKENS)) map[escapeXml(token)] = values[key] || "";
  for (const [find, put] of Object.entries(template.pptText || {})) map[escapeXml(find)] = fill(put);
  return map;
}

async function makePPT(template, background, values) {
  const buffer = await loadPptFile(assetUrl(template, background.ppt));
  if (!canInflate) return { blob: new Blob([buffer]), filled: false };
  const files = await readZip(buffer);
  const replacements = pptReplacements(template, values);
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  let found = 0;
  for (const file of files) {
    if (!/^ppt\/(slides|notesSlides)\/[^/]+\.xml$/.test(file.name)) continue;
    const result = fillSlideXml(decoder.decode(file.data), replacements);
    found += result.found;
    file.data = encoder.encode(result.xml);
  }
  if (!found) console.warn(`[DM STUDIO] ${template.folder}/${background.ppt} 에서 바꿀 글자({고객명} 또는 pptText 에 적은 글자)를 찾지 못했어요.`);
  return {
    blob: new Blob([makeZip(files)], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }),
    filled: true
  };
}

/* ---------- 저장 ---------- */
let claudeDownloads = null;   // Claude 미리보기 화면에서만 쓰는 저장 기능 (GitHub Pages 에서는 쓰지 않음)
if (window.claude?.use) window.claude.use("downloads").then(d => { claudeDownloads = d; }).catch(() => {});

export async function saveFile(name, blob) {
  if (claudeDownloads) {
    try { await claudeDownloads.save({ filename: name, data: blob }); return "saved"; }
    catch (error) { return error?.code === "declined" ? "cancelled" : "failed"; }
  }
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return "saved";
}

/** 휴대폰(앱 밖 브라우저)에서는 공유창으로 카카오톡에 바로 보낼 수 있어요 */
export const canShareFiles = (() => {
  try {
    // 휴대폰에서만 공유창을 씁니다. PC(윈도우 공유창 등)에서는 그냥 다운로드합니다.
    const isPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
    return isPhone && window.top === window && !!navigator.canShare &&
      navigator.canShare({ files: [new File([""], "a.jpg", { type: "image/jpeg" })] });
  } catch {
    return false;
  }
})();

const safeName = text => String(text).replace(/[\\/:*?"<>|]/g, "").trim();

/**
 * @param {"jpg"|"pptx"} kind
 * @param {object} template
 * @param {Array<object>} people   고객별 values
 * @param {object} choice  { background, logo }
 * @param {(done:number,total:number)=>void} onProgress
 * @returns {{status:"saved"|"shared"|"cancelled"|"failed", count:number, filled?:boolean}}
 */
export async function createAndSave(kind, template, people, choice, onProgress) {
  const base = safeName(template.fileName || template.title);
  const background = template.backgrounds.find(bg => bg.id === choice.background) || template.backgrounds[0];
  const files = [];
  let filled = true;
  for (const [index, values] of people.entries()) {
    onProgress?.(index + 1, people.length);
    if (kind === "jpg") {
      const blob = await renderToBlob(template, values, choice);
      files.push(new File([blob], safeName(`${base}_${values.customerName}고객님.jpg`), { type: "image/jpeg" }));
    } else {
      const result = await makePPT(template, background, values);
      filled = filled && result.filled;
      files.push(new File([result.blob], safeName(`${base}_${values.customerName}고객님.pptx`), { type: result.blob.type }));
    }
  }

  if (kind === "jpg" && canShareFiles && navigator.canShare({ files })) {
    try {
      await navigator.share({ files, title: template.title });
      return { status: "shared", count: files.length };
    } catch (error) {
      if (error?.name === "AbortError") return { status: "cancelled", count: 0 };
    }
  }
  if (files.length === 1) {
    return { status: await saveFile(files[0].name, files[0]), count: 1, filled };
  }
  const zipFiles = await Promise.all(files.map(async file => ({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) })));
  const label = kind === "jpg" ? "사진" : "PPT";
  const status = await saveFile(`${base}_${label}${files.length}개.zip`, makeZip(zipFiles));
  return { status, count: files.length, filled, zipped: true };
}
