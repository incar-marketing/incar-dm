/**
 * templates.js — 템플릿 불러오기와 설정 검사
 *
 * templates/manifest.json 의 순서대로 각 폴더의 template.json 을 불러옵니다.
 * 한 템플릿의 설정이 틀리면 그 템플릿만 빠지고, 나머지는 정상으로 보입니다.
 * (무엇이 틀렸는지는 브라우저 개발자 도구의 콘솔에 경고로 남깁니다.)
 */

const ROOT = "templates/";

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

const FONTS = ["buri", "dotum", "script", "suit"];

export function formatPhone(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 11);
  if (digits.length < 4) return digits;
  if (digits.length < 8) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 7)}.${digits.slice(7)}`;
}

/** 설정 검사: 문제 목록을 돌려줍니다. 빈 배열이면 통과. */
function validate(t, themeIds) {
  const problems = [];
  const need = (ok, message) => { if (!ok) problems.push(message); };
  need(typeof t.title === "string" && t.title.trim(), "title(제목)이 없어요");
  need(/^\d{4}-\d{2}$/.test(t.month || ""), "month 는 \"2026-11\" 형식이어야 해요");
  need(Array.isArray(t.themes) && t.themes.length && t.themes.every(id => themeIds.has(id)),
    `themes 는 manifest 의 테마 id 중에서 골라야 해요 (${[...themeIds].join(", ")})`);
  need(t.size && t.size.width > 0 && t.size.height > 0, "size.width / size.height 가 없어요");
  need(Array.isArray(t.backgrounds) && t.backgrounds.length && t.backgrounds.every(bg => bg.id && bg.file),
    "backgrounds 에 id 와 file 이 있는 배경이 하나 이상 필요해요");
  need(Array.isArray(t.fields) && t.fields.every(key => FIELDS[key]), `fields 는 ${Object.keys(FIELDS).join(", ")} 중에서 골라야 해요`);
  need(Array.isArray(t.texts) && t.texts.every(item =>
    typeof item.text === "string" && Number.isFinite(item.x) && Number.isFinite(item.y) && FONTS.includes(item.font) && item.size > 0),
  "texts 의 각 줄에는 text, x, y, font(buri/dotum/script/suit), size 가 필요해요");
  need(["published", "draft"].includes(t.status), "status 는 published 또는 draft 여야 해요");
  need(t.pptText === undefined || (t.pptText && typeof t.pptText === "object" && Object.values(t.pptText).every(v => typeof v === "string")),
    "pptText 는 { \"PPT 안의 글자\": \"{customerName}\" } 모양이어야 해요");
  return problems;
}

async function fetchJSON(path) {
  const response = await fetch(path, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${path} 를 찾을 수 없어요 (${response.status})`);
  return response.json();
}

/** 템플릿 경로 안의 파일 주소 */
export const assetUrl = (template, file) => `${ROOT}${template.folder}/${file}`;

export async function loadCatalog() {
  const manifest = await fetchJSON(`${ROOT}manifest.json`);
  const themes = manifest.themes || [];
  const themeIds = new Set(themes.map(theme => theme.id));
  const entries = (manifest.templates || []).filter(entry => entry.folder && !entry.hidden);

  const results = await Promise.all(entries.map(async (entry, order) => {
    try {
      const data = await fetchJSON(`${ROOT}${entry.folder}/template.json`);
      const problems = validate(data, themeIds);
      if (problems.length) {
        console.warn(`[DM STUDIO] templates/${entry.folder} 를 목록에서 뺐어요:\n- ${problems.join("\n- ")}`);
        return null;
      }
      return { ...data, id: entry.folder, folder: entry.folder, order };
    } catch (error) {
      console.warn(`[DM STUDIO] templates/${entry.folder} 를 불러오지 못했어요: ${error.message}`);
      return null;
    }
  }));

  return {
    themes,
    upcoming: manifest.upcoming || [],
    templates: results.filter(Boolean)
  };
}

/** 이번 달 템플릿이면 NEW */
export function isNew(template) {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return template.month === thisMonth;
}

export function monthLabel(template) {
  const [year, month] = template.month.split("-");
  return `${year}년 ${Number(month)}월`;
}
