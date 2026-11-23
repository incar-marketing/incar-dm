/**
 * ui.js — 여러 화면이 함께 쓰는 부품: 글자 이스케이프, 알림, 창(모달), DM 카드, 버튼 '만드는 중' 상태
 */
import { assetUrl, isNew, monthLabel, formatPhone } from "./templates.js?v=20261123b";
import { store } from "./store.js?v=20261123b";

export const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- 측정 (GTM dataLayer) ---------- */
export function track(event, params = {}) {
  (window.dataLayer = window.dataLayer || []).push({ event, ...params });
}

/* ---------- 알림 (한 번에 하나) ---------- */
const toastBox = document.getElementById("toast");
let toastTimer = 0;
export function toast(message) {
  toastBox.textContent = message;
  toastBox.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastBox.hidden = true; }, 2800);
}

/* ---------- 창 (모달) ---------- */
const layer = document.getElementById("layer");
let closeCurrent = null;

/**
 * @param {object} options
 * @param {string} options.html          창 안쪽 HTML
 * @param {string} options.labelledBy    제목 요소 id
 * @param {boolean} [options.dismissible=true]  Esc·바깥 누르기로 닫을 수 있는지
 * @param {(box:HTMLElement, close:Function)=>void} options.onOpen
 */
export function openModal({ html, labelledBy, dismissible = true, onOpen }) {
  closeCurrent?.();
  const returnFocus = document.activeElement;
  layer.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="${labelledBy}">
    <div class="modal__box">${html}</div></div>`;
  const overlay = layer.firstElementChild;
  const box = overlay.firstElementChild;
  document.body.classList.add("is-locked");

  const onKey = event => {
    if (event.key === "Escape" && dismissible) close();
    if (event.key === "Tab") {   // 창 밖으로 포커스가 나가지 않게
      const items = box.querySelectorAll("button, input, [href]");
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault(); }
      else if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault(); }
    }
  };
  const onClick = event => { if (event.target === overlay && dismissible) close(); };
  function close() {
    document.removeEventListener("keydown", onKey);
    overlay.removeEventListener("click", onClick);
    layer.innerHTML = "";
    document.body.classList.remove("is-locked");
    closeCurrent = null;
    if (returnFocus?.isConnected) returnFocus.focus();
  }
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", onClick);
  closeCurrent = close;
  onOpen?.(box, close);
  return close;
}

/* ---------- DM 카드 (DM 고르기 · 저장 후 추천에서 함께 사용) ---------- */
export function badgeHtml(template) {
  if (template.status === "draft") return `<b class="badge badge--draft">시안</b>`;
  return isNew(template) ? `<b class="badge badge--new">NEW</b>` : "";
}

export function cardHtml(template, { compact = false } = {}) {
  const title = escapeHtml(template.title);
  const thumb = `<img src="${assetUrl(template, template.thumbnail)}" alt="" loading="lazy" decoding="async">`;
  if (compact) {
    return `<article class="dm-row">
      <span class="dm-row__thumb">${thumb}</span>
      <div class="dm-row__meta"><small>${monthLabel(template)} ${badgeHtml(template)}</small><strong>${title}</strong></div>
      <button type="button" class="btn btn--primary btn--sm" data-open="${template.id}">DM 만들기</button>
    </article>`;
  }
  return `<article class="dm-card">
    <button type="button" class="dm-card__thumb" data-open="${template.id}" aria-label="${title} 고르기">${thumb}</button>
    <div class="dm-card__meta"><small>${monthLabel(template)} ${badgeHtml(template)}</small><strong>${title}</strong></div>
    <button type="button" class="btn btn--primary dm-card__go" data-open="${template.id}" tabindex="-1" aria-hidden="true">고르기</button>
  </article>`;
}

export const upcomingHtml = (item, className = "dm-card dm-card--soon") =>
  `<div class="${className}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.note || "준비 중이에요")}</span></div>`;

/* ---------- 버튼 '만드는 중' (두 번 누르기 막기) ---------- */
export function setBusy(buttons, busy) {
  for (const button of buttons) {
    button.disabled = busy;
    button.setAttribute("aria-busy", String(busy));
  }
}

/* ---------- 내 정보 창 (처음 한 번 + '내 정보 고치기') ---------- */

/**
 * @param {object} options
 * @param {boolean} options.first   처음 방문이면 닫기 없이 꼭 입력하게
 * @param {Function} [options.onSaved]
 */
export function openProfileModal({ first, onSaved }) {
  const profile = store.profile || {};
  openModal({
    labelledBy: "profile-title",
    dismissible: !first,
    html: `
      <form class="profile" novalidate>
        ${first ? "" : `<div class="modal__top"><span></span><button type="button" class="icon-btn" data-close aria-label="닫기">✕</button></div>`}
        <div><h2 id="profile-title" class="modal__title">${first ? "정보를 입력해주세요!" : "내 정보 고치기"}</h2>
          <p class="modal__sub">DM에 일괄 적용돼요.</p></div>
        <div class="form-grid">
          <div class="field">
            <label for="profile-name">내 이름</label>
            <input class="input" id="profile-name" name="agentName" autocomplete="name" maxlength="20" placeholder="예) 김인카" value="${escapeHtml(profile.agentName || "")}">
            <span class="field__error" hidden>내 이름을 적어 주세요.</span>
          </div>
          <div class="field">
            <label for="profile-phone">내 연락처</label>
            <input class="input" id="profile-phone" name="agentPhone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="010.0000.0000" value="${escapeHtml(profile.agentPhone || "")}">
            <span class="field__error" hidden>휴대폰 번호를 확인해 주세요.</span>
          </div>
        </div>
        <button class="btn btn--primary btn--block btn--lg">${first ? "저장하고 DM 고르기" : "저장하기"}</button>
      </form>`,
    onOpen(box, close) {
      const form = box.querySelector("form");
      const name = form.elements.agentName, phone = form.elements.agentPhone;
      const showError = (input, show) => {
        input.classList.toggle("is-invalid", show);
        input.setAttribute("aria-invalid", String(show));
        input.closest(".field").querySelector(".field__error").hidden = !show;
      };
      name.addEventListener("input", () => {
        showError(name, false);
      });
      phone.addEventListener("input", () => { phone.value = formatPhone(phone.value); showError(phone, false); });
      box.querySelector("[data-close]")?.addEventListener("click", close);
      form.addEventListener("submit", event => {
        event.preventDefault();
        const agentName = name.value.trim(), agentPhone = phone.value.trim();
        const digits = agentPhone.replace(/\D/g, "").length;
        showError(name, !agentName);
        showError(phone, digits < 9);
        if (!agentName) return name.focus();
        if (digits < 9) return phone.focus();
        store.setProfile({ agentName, agentPhone });
        close();
        if (!first) toast("내 정보를 바꿨어요");
        onSaved?.();
      });
      setTimeout(() => name.focus(), 30);
    }
  });
}
