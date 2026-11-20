/**
 * pages/gallery.js — DM 고르기: 테마 탭 · 검색 · DM 카드
 */
import { cardHtml, upcomingHtml, escapeHtml } from "../ui.js";
import { monthLabel } from "../templates.js";

const state = { theme: "all", query: "" };

/** 로고를 누르면 처음 화면(전체 · 검색 없음)으로 */
export function resetGallery() {
  state.theme = "all";
  state.query = "";
}

/* ---------- 검색 ----------
 * 제목 · 키워드 · 테마 이름 · 월에서 찾습니다.
 * 한글을 자음·모음으로 풀어서 비교하므로 '물든'으로도 '물드는'이, 치는 중인 '가으'로도 '가을'이 찾아집니다.
 * '건강한'처럼 뒤에 말이 붙으면 끝 글자를 하나씩 떼어 가며 다시 찾습니다(두 글자까지).
 */
const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const JONG = ["", ..."ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"];
const IGNORE = new Set(["dm", "디엠", "템플릿", "문자"]);

const jamo = text => [...text.toLowerCase().replace(/\s+/g, "")].map(ch => {
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return ch;
  return CHO[Math.floor(code / 588)] + JUNG[Math.floor((code % 588) / 28)] + JONG[code % 28];
}).join("");

const searchText = (template, themes) => jamo([
  template.title, template.month, monthLabel(template), ...(template.keywords || []),
  ...template.themes.map(id => themes.find(theme => theme.id === id)?.name || "")
].join(" "));

function wordMatches(haystack, word) {
  for (let w = word; w.length >= Math.min(2, word.length); w = w.slice(0, -1)) {
    if (haystack.includes(jamo(w))) return true;
  }
  return false;
}

function matches(template, themes, query) {
  const words = query.toLowerCase().split(/[\s,]+|(?<=[가-힣])(?=[a-z0-9])|(?<=[a-z0-9])(?=[가-힣])/)
    .filter(word => word && !IGNORE.has(word));
  if (!words.length) return true;
  const haystack = searchText(template, themes);
  return words.every(word => wordMatches(haystack, word));
}

/**
 * @param {HTMLElement} root
 * @param {{themes:Array, templates:Array, upcoming:Array}} catalog
 * @param {(id:string)=>void} openTemplate
 */
export function renderGallery(root, catalog, openTemplate) {
  const { themes, templates, upcoming } = catalog;
  const tabs = [{ id: "all", name: "전체" }, ...themes];
  if (!tabs.some(tab => tab.id === state.theme)) state.theme = "all";
  const countOf = id => (id === "all" ? templates.length : templates.filter(t => t.themes.includes(id)).length);

  root.innerHTML = `
    <section class="gallery" aria-labelledby="gallery-title">
      <div class="gallery__head">
        <h1 id="gallery-title" class="page-title"><span class="highlight">어떤 DM을 보낼까요?</span></h1>
        <form class="search" role="search">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/></svg>
          <input type="search" name="q" placeholder="생일, 만기, 새해…" aria-label="DM 검색" autocomplete="off" value="${escapeHtml(state.query)}">
        </form>
      </div>
      <div class="tabs" role="tablist" aria-label="테마">
        ${tabs.map(tab => `<button type="button" role="tab" class="tab" data-theme="${tab.id}" aria-selected="${state.theme === tab.id}">${escapeHtml(tab.name)} <span>${countOf(tab.id)}</span></button>`).join("")}
      </div>
      <div class="gallery__grid" aria-live="polite"></div>
    </section>`;

  const grid = root.querySelector(".gallery__grid");
  const input = root.querySelector("input[name=q]");

  const paint = () => {
    const query = state.query.trim();
    // 검색할 때는 테마와 상관없이 전체에서 찾습니다
    const theme = query ? "all" : state.theme;
    root.querySelectorAll("[data-theme]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.theme === theme)));
    const list = templates.filter(t => (theme === "all" || t.themes.includes(theme)) && matches(t, themes, query));
    grid.innerHTML = list.length
      ? list.map(t => cardHtml(t)).join("") + (query ? "" : upcoming.map(item => upcomingHtml({ ...item, note: "준비 중이에요" })).join(""))
      : `<div class="empty"><strong>${query ? `‘${escapeHtml(query)}’에 맞는 DM이 아직 없어요` : "이 테마는 준비 중이에요"}</strong>
          <span>다른 말로 찾아보거나 <button type="button" class="link" data-reset>전체 DM 보기</button></span></div>`;
  };

  // 클릭은 화면 바깥 상자 하나에서 처리합니다 (카드가 다시 그려져도 리스너가 늘지 않음)
  root.querySelector(".gallery").addEventListener("click", event => {
    const tab = event.target.closest("[data-theme]");
    if (tab) {
      state.theme = tab.dataset.theme;
      state.query = ""; input.value = "";   // 탭을 누르면 검색어는 비웁니다
      root.querySelectorAll("[data-theme]").forEach(b => b.setAttribute("aria-selected", String(b === tab)));
      return paint();
    }
    const open = event.target.closest("[data-open]");
    if (open) return openTemplate(open.dataset.open);
    if (event.target.closest("[data-reset]")) {
      state.theme = "all"; state.query = ""; input.value = "";
      root.querySelectorAll("[data-theme]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.theme === "all")));
      paint();
    }
  });
  input.addEventListener("input", () => { state.query = input.value; paint(); });
  root.querySelector(".search").addEventListener("submit", event => { event.preventDefault(); input.blur(); });
  paint();
}
