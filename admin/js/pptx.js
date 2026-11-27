/**
 * admin/js/pptx.js — PPT 안의 {고객명}·{설계사명}(또는 {설계사})·{연락처}(또는 010.0000.0000) 표시를 찾아 글자 자리(texts)로 바꿉니다.
 *
 * PPT 에서 표시가 든 글상자의 위치·크기·정렬·글자 크기·색·자간을 읽어 DM 가로 800 기준 값으로 옮깁니다.
 * 표시는 사용자 화면의 PPT 저장(download.js)과 같은 PPT_TOKENS 를 씁니다 → 같은 PPT로 PPT 저장도 그대로 됩니다.
 * PPT 를 그림으로 바꾸는 일은 하지 않습니다(배경 그림은 따로 올림). 읽은 값은 관리자가 미리보기로 확인·조정합니다.
 */
import { PPT_TOKENS } from "../../assets/js/templates.js?v=20261127h";
import { readZip } from "../../assets/js/download.js?v=20261127h";

export const PPT_RULES = { maxBytes: 15 * 1024 * 1024 };
const EMU_PER_PT = 12700;
const LINE_HALF = 0.75;   // 글자 크기 대비 한 줄 높이의 절반 (기존 DM들과 1px 안쪽으로 맞춘 값)
const ALIGN = { l: "left", ctr: "center", r: "right", just: "left" };
/** 기본 표시({고객명} 등) 말고도 알아보는 글자. 찾으면 template.json 의 pptText 로 저장해 PPT 저장 때도 바뀝니다 */
const PPT_ALIASES = {
  "{설계사}": "agentName",
  "010.0000.0000": "agentPhone", "010-0000-0000": "agentPhone",
  "010.000.0000": "agentPhone", "010-000-0000": "agentPhone"
};

const attr = (xml, name) => xml?.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const unescapeXml = text => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** PPT 글꼴 이름 → DM 글꼴 (SUIT·아리따 부리·아리따 돋움 중 가장 가까운 것, 모르면 SUIT) */
function fontFor(typeface = "") {
  if (/buri|부리|myeongjo|명조|batang|바탕|serif/i.test(typeface)) return "buri";
  if (/dotum|돋움/i.test(typeface)) return "dotum";
  return "suit";
}

/** 굵기: 굵게 버튼(b="1") 또는 글꼴 이름의 Bold·Heavy 등 */
function weightFor(run) {
  const typeface = run.match(/<a:(?:ea|latin) typeface="([^"]*)"/)?.[1] || "";
  if (/extra ?bold|heavy|black/i.test(typeface)) return 800;
  return attr(run, "b") === "1" || /bold|\sB$/i.test(typeface) ? 700 : 400;
}

/**
 * @param {File} file  .pptx
 * @param {number} dmWidth  글자 위치 기준 폭 (800)
 * @returns {{ ratio:number, texts:Array, marks:Array, missing:string[], pptText:object }}  ratio = 슬라이드 세로/가로
 */
export async function readPptLayout(file, dmWidth) {
  if (file.size > PPT_RULES.maxBytes) throw new Error("PPT 파일은 15MB 이하로 올려 주세요");
  const buffer = await file.arrayBuffer();
  const head = new Uint8Array(buffer, 0, 4);
  if (head[0] !== 0x50 || head[1] !== 0x4b) throw new Error("PPT(.pptx) 파일만 올릴 수 있어요");
  let files;
  try { files = await readZip(buffer); } catch { throw new Error("PPT 파일을 읽지 못했어요. PowerPoint에서 .pptx로 다시 저장해 주세요"); }
  const text = name => new TextDecoder().decode(files.find(f => f.name === name)?.data || new Uint8Array());

  const slideSize = text("ppt/presentation.xml").match(/<p:sldSz[^>]*>/)?.[0];
  const slideWidth = Number(attr(slideSize, "cx")), slideHeight = Number(attr(slideSize, "cy"));
  const slide = text("ppt/slides/slide1.xml");
  if (!slideWidth || !slide) throw new Error("PPT에서 슬라이드를 찾지 못했어요");
  const scale = dmWidth / slideWidth;                     // EMU → DM px
  const ptToPx = EMU_PER_PT * scale;
  const tokenToKey = { ...Object.fromEntries(Object.entries(PPT_TOKENS).map(([key, token]) => [token, key])), ...PPT_ALIASES };
  const aliasesFound = new Set();
  const round = value => Math.round(value * 10) / 10;
  const texts = [];
  const marks = [];   // 배경 그림에 찍혀 있을 표시 글자(원래 글자 그대로)와 자리 — 배경에서 지울 때 씁니다

  for (const shape of slide.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []) {
    const off = shape.match(/<a:off[^>]*>/)?.[0], ext = shape.match(/<a:ext[^>]*>/)?.[0];
    if (!off || !ext) continue;
    const box = { x: +attr(off, "x"), y: +attr(off, "y"), w: +attr(ext, "cx"), h: +attr(ext, "cy") };
    const body = shape.match(/<a:bodyPr[^>]*>/)?.[0] || "";
    const inset = { l: +(attr(body, "lIns") ?? 91440), r: +(attr(body, "rIns") ?? 91440), t: +(attr(body, "tIns") ?? 45720), b: +(attr(body, "bIns") ?? 45720) };
    const anchor = attr(body, "anchor") || "t";
    const paragraphs = shape.match(/<a:p>[\s\S]*?<\/a:p>/g) || [];

    paragraphs.forEach((paragraph, index) => {
      // PowerPoint 는 한 단어를 여러 조각으로 나눠 저장하기도 해서 문단 글자를 이어 붙여 봅니다
      const joined = unescapeXml((paragraph.match(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g) || []).map(t => t.replace(/<[^>]+>/g, "")).join(""));
      if (!Object.keys(tokenToKey).some(token => joined.includes(token))) return;
      Object.keys(PPT_ALIASES).filter(alias => joined.includes(alias)).forEach(alias => aliasesFound.add(alias));
      const run = paragraph.match(/<a:rPr[^>]*\/?>(?:[\s\S]*?<\/a:rPr>)?/)?.[0] || "";
      const size = (Number(attr(run, "sz")) || 1800) / 100 * ptToPx;
      const align = ALIGN[attr(paragraph.match(/<a:pPr[^>]*>/)?.[0], "algn")] || "left";
      const left = (box.x + inset.l) * scale, right = (box.x + box.w - inset.r) * scale;
      const top = (box.y + inset.t) * scale, bottom = (box.y + box.h - inset.b) * scale;
      const lineHeight = size * LINE_HALF * 2;
      const linesBelow = paragraphs.length - 1 - index;
      const y = anchor === "ctr" ? (top + bottom) / 2 + (index - (paragraphs.length - 1) / 2) * lineHeight
        : anchor === "b" ? bottom - size * LINE_HALF - linesBelow * lineHeight
        : top + size * LINE_HALF + index * lineHeight;
      const item = {
        text: Object.entries(tokenToKey).reduce((out, [token, key]) => out.split(token).join(`{${key}}`), joined),
        x: round(align === "center" ? (left + right) / 2 : align === "right" ? right : left),
        y: round(y),
        maxWidth: Math.round(right - left),
        font: fontFor(run.match(/<a:(?:ea|latin) typeface="([^"]*)"/)?.[1]),
        size: round(size),
        weight: weightFor(run),
        color: `#${(run.match(/<a:srgbClr val="([0-9A-Fa-f]{6})"/)?.[1] || "000000").toLowerCase()}`,
        align
      };
      const spacing = Number(attr(run, "spc"));   // 1/100 pt
      if (spacing) item.letterSpacing = round(spacing / 100 * ptToPx);
      texts.push(item);
      marks.push({ text: joined, x: item.x, y: item.y, size: item.size, align, weight: item.weight, maxWidth: item.maxWidth });
    });
  }
  const used = new Set(texts.flatMap(item => [...item.text.matchAll(/\{(\w+)\}/g)].map(m => m[1])));
  return {
    ratio: slideHeight / slideWidth,
    texts,
    marks,
    missing: Object.entries(PPT_TOKENS).filter(([key]) => !used.has(key)).map(([, token]) => token),
    pptText: Object.fromEntries([...aliasesFound].map(alias => [alias, `{${PPT_ALIASES[alias]}}`]))
  };
}
