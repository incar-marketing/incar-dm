/**
 * pages/gallery.js — DM 고르기: 테마 탭 · DM 카드
 */
import { cardHtml, escapeHtml } from "../ui.js?v=20261127c";

const state = { theme: "all" };

/** 로고를 누르면 처음 화면(전체)으로 */
export function resetGallery() {
  state.theme = "all";
}

/**
 * @param {HTMLElement} root
 * @param {{themes:Array, templates:Array}} catalog
 * @param {(id:string)=>void} openTemplate
 */
export function renderGallery(root, catalog, openTemplate) {
  const { themes, templates: cards } = catalog;
  const tabs = [{ id: "all", name: "전체보기" }, ...themes];
  if (!tabs.some(tab => tab.id === state.theme)) state.theme = "all";
  const countOf = id => (id === "all" ? cards.length : cards.filter(t => t.themes.includes(id)).length);

  root.innerHTML = `
    <section class="gallery" aria-labelledby="gallery-title">
      <div class="gallery__head">
        <h1 id="gallery-title" class="page-title">고객에게 보내려는 DM을 선택하세요</h1>
      </div>
      <div class="tabs" role="tablist" aria-label="테마">
        ${tabs.map(tab => `<button type="button" role="tab" class="tab" data-theme="${tab.id}" aria-selected="${state.theme === tab.id}">${escapeHtml(tab.name)}<span>(${countOf(tab.id)}${tab.id === "all" ? "개" : "장"})</span></button>`).join("")}
      </div>
      <div class="gallery__grid" aria-live="polite"></div>
    </section>`;

  const grid = root.querySelector(".gallery__grid");

  const paint = () => {
    root.querySelectorAll("[data-theme]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.theme === state.theme)));
    const selected = root.querySelector('.tab[aria-selected="true"]');
    if (selected && matchMedia("(max-width: 767px)").matches) {
      const tabs = selected.parentElement;
      const offset = selected.offsetLeft - tabs.offsetLeft;
      if (offset < tabs.scrollLeft || offset + selected.offsetWidth > tabs.scrollLeft + tabs.clientWidth) tabs.scrollLeft = offset;
    }
    const list = cards.filter(t => state.theme === "all" || t.themes.includes(state.theme));
    grid.innerHTML = list.length
      ? list.map(t => cardHtml(t)).join("")
      : `<div class="empty"><strong>등록된 DM이 없습니다.</strong>
          <span><button type="button" class="link" data-reset>전체 DM 보기</button></span></div>`;
  };

  // 클릭은 화면 바깥 상자 하나에서 처리합니다 (카드가 다시 그려져도 리스너가 늘지 않음)
  root.querySelector(".gallery").addEventListener("click", event => {
    const tab = event.target.closest("[data-theme]");
    if (tab) {
      state.theme = tab.dataset.theme;
      paint();
      // 아래로 내려 둔 채 탭을 바꾸면 목록 처음으로 (탭은 상단에 붙어 있음)
      const top = root.querySelector(".gallery__grid").getBoundingClientRect().top + window.scrollY - tab.parentElement.offsetHeight - 80;
      if (window.scrollY > top) window.scrollTo({ top: Math.max(0, top), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      return;
    }
    const open = event.target.closest("[data-open]");
    if (open) return openTemplate(open.dataset.open);
    if (event.target.closest("[data-reset]")) { state.theme = "all"; paint(); }
  });
  paint();
}
