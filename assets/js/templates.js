/**
 * templates.js — 템플릿 불러오기와 설정 검사
 *
 * templates/manifest.json 의 순서대로 각 폴더의 template.json 을 불러옵니다.
 * 한 템플릿의 설정이 틀리면 그 템플릿만 빠지고, 나머지는 정상으로 보입니다.
 * (무엇이 틀렸는지는 브라우저 개발자 도구의 콘솔에 경고로 남깁니다.)
 */

const ROOT = "templates/";

/** 공개 상태: published 공개 · draft 시안(목록에 보이지만 저장 막힘) · hidden 비공개(목록에서 빠짐) */
export const STATUSES = ["published", "draft", "hidden"];

/** 편집 항목 정의: 모든 템플릿이 함께 씁니다. 형식을 바꾸면 모든 DM에 한 번에 반영됩니다. */
export const FIELDS = {
  customerName: { label: "고객 이름", placeholder: "고객명", source: "customer", maxLength: 20 },
  agentName: { label: "내 이름", placeholder: "내 이름", source: "profile", maxLength: 20 },
  agentPhone: { label: "내 연락처", placeholder: "휴대폰 번호", source: "profile", format: "phone" }
};

/** PPT 안에서 바꿀 글자 (마케팅부가 PPT에 그대로 적어 두는 표시) */
export const PPT_TOKENS = {
  customerName: "{고객명}",
  agentName: "{설계사명}",
  agentPhone: "{연락처}"
};

export const FONTS = ["buri", "dotum", "script", "suit"];

export function formatPhone(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 8) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 7)}.${digits.slice(7)}`;
}

/** 설정 검사: 문제 목록을 돌려줍니다. 빈 배열이면 통과. (관리자 페이지도 저장 전에 같은 검사를 씁니다) */
export function validate(t, themeIds) {
  const problems = [];
  const need = (ok, message) => { if (!ok) problems.push(message); };
  need(typeof t.title === "string" && t.title.trim(), "title(제목)이 없어요");
  need(/^\d{4}-\d{2}-\d{2}$/.test(t.uploadedAt || ""), "uploadedAt(업로드 날짜)은 \"2026-11-24\" 형식이어야 해요");
  need(t.showNew === undefined || typeof t.showNew === "boolean", "showNew 는 true 또는 false 여야 해요");
  need(Array.isArray(t.themes) && t.themes.length && t.themes.every(id => themeIds.has(id)),
    `themes 는 manifest 의 테마 id 중에서 골라야 해요 (${[...themeIds].join(", ")})`);
  need(t.size && t.size.width > 0 && t.size.height > 0, "size.width / size.height 가 없어요");
  need(Array.isArray(t.backgrounds) && t.backgrounds.length && t.backgrounds.every(bg => bg.id && bg.file),
    "backgrounds 에 id 와 file 이 있는 배경이 하나 이상 필요해요");
  need(Array.isArray(t.fields) && t.fields.every(key => FIELDS[key]), `fields 는 ${Object.keys(FIELDS).join(", ")} 중에서 골라야 해요`);
  need(Array.isArray(t.texts) && t.texts.every(item =>
    typeof item.text === "string" && Number.isFinite(item.x) && Number.isFinite(item.y) && FONTS.includes(item.font) && item.size > 0),
  "texts 의 각 줄에는 text, x, y, font(buri/dotum/script/suit), size 가 필요해요");
  need(STATUSES.includes(t.status), `status 는 ${STATUSES.join(", ")} 중 하나여야 해요`);
  need(t.pptText === undefined || (t.pptText && typeof t.pptText === "object" && Object.values(t.pptText).every(v => typeof v === "string")),
    "pptText 는 { \"PPT 안의 글자\": \"{customerName}\" } 모양이어야 해요");
  return problems;
}

export async function fetchJSON(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${path} 를 찾을 수 없어요 (${response.status})`);
  return response.json();
}

/** 템플릿 경로 안의 파일 주소 */
export const assetUrl = (template, file) => `${ROOT}${template.folder}/${file}`;

/**
 * manifest.json(카테고리·순서)과 각 template.json(DM 내용)을 불러옵니다.
 * @param {object} [options]
 * @param {boolean} [options.includeHidden=false]  비공개 DM도 포함 (관리자 페이지용)
 */
export async function loadCatalog({ includeHidden = false } = {}) {
  const manifest = await fetchJSON(`${ROOT}manifest.json`);
  const themes = manifest.themes || [];
  const themeIds = new Set(themes.map(theme => theme.id));
  const entries = (manifest.templates || []).filter(entry => entry.folder);

  const results = await Promise.all(entries.map(async (entry, order) => {
    try {
      const data = await fetchJSON(`${ROOT}${entry.folder}/template.json`);
      const problems = validate(data, themeIds);
      if (problems.length) {
        console.warn(`[DM STUDIO] templates/${entry.folder} 를 목록에서 뺐어요:\n- ${problems.join("\n- ")}`);
        return null;
      }
      if (data.status === "hidden" && !includeHidden) return null;
      return { ...data, id: entry.folder, folder: entry.folder, order };
    } catch (error) {
      console.warn(`[DM STUDIO] templates/${entry.folder} 를 불러오지 못했어요: ${error.message}`);
      return null;
    }
  }));

  return { themes, templates: results.filter(Boolean) };
}

/** NEW 를 자동으로 붙이는 기간(업로드 날짜부터 며칠) — 바꾸려면 이 숫자만 고치세요 */
export const NEW_DAYS = 14;

/** NEW 표시: showNew 가 true/false 면 그대로, 값이 없으면(자동) 업로드 날짜부터 NEW_DAYS 일 동안만 NEW */
export function isNew(template) {
  if (typeof template.showNew === "boolean") return template.showNew;
  const [year, month, day] = template.uploadedAt.split("-").map(Number);
  const uploaded = new Date(year, month - 1, day);          // 이 기기 시간 기준 그날 0시
  const days = (Date.now() - uploaded.getTime()) / 86400000;
  return days >= 0 && days < NEW_DAYS;
}

export function monthLabel(template) {
  const [year, month] = template.uploadedAt.split("-");
  return `${year}년 ${Number(month)}월`;
}
