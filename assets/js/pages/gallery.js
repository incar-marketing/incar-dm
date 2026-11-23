/**
 * pages/gallery.js — DM 고르기: 테마 탭 · DM 카드
 */
import { cardHtml, upcomingHtml, escapeHtml } from "../ui.js?v=20261123a";

const state = { theme: "all" };

/** 로고를 누르면 처음 화면(전체)으로 */
export function resetGallery() {
  state.theme = "all";
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
      </div>
      <div class="tabs" role="tablist" aria-label="테마">
        ${tabs.map(tab => `<button type="button" role="tab" class="tab" data-theme="${tab.id}" aria-selected="${state.theme === tab.id}">${escapeHtml(tab.name)} <span>${countOf(tab.id)}</span></button>`).join("")}
      </div>
      <div class="gallery__grid" aria-live="polite"></div>
    </section>`;

  const grid = root.querySelector(".gallery__grid");

  const paint = () => {
    root.querySelectorAll("[data-theme]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.theme === state.theme)));
    const list = templates.filter(t => state.theme === "all" || t.themes.includes(state.theme));
    grid.innerHTML = list.length
      ? list.map(t => cardHtml(t)).join("") + upcoming.map(item => upcomingHtml({ ...item, note: "준비 중이에요" })).join("")
      : `<div class="empty"><strong>이 테마는 준비 중이에요</strong>
          <span><button type="button" class="link" data-reset>전체 DM 보기</button></span></div>`;
  };

  // 클릭은 화면 바깥 상자 하나에서 처리합니다 (카드가 다시 그려져도 리스너가 늘지 않음)
  root.querySelector(".gallery").addEventListener("click", event => {
    const tab = event.target.closest("[data-theme]");
    if (tab) { state.theme = tab.dataset.theme; return paint(); }
    const open = event.target.closest("[data-open]");
    if (open) return openTemplate(open.dataset.open);
    if (event.target.closest("[data-reset]")) { state.theme = "all"; paint(); }
  });
  paint();
}
