/**
 * pages/editor.js — 고객 이름 넣기 · 미리보기 · 저장 · 저장 후 추천
 */
import { store } from "../store.js?v=20261127e";
import { FIELDS } from "../templates.js?v=20261127e";
import { renderDM } from "../renderer.js?v=20261127e";
import { createAndSave } from "../download.js?v=20261127e";
import { escapeHtml, toast, openProfileModal, cardHtml, setBusy, track } from "../ui.js?v=20261127e";

const PLACEHOLDERS = Object.fromEntries(Object.entries(FIELDS).map(([key, field]) => [key, field.placeholder]));
const cleanName = value => value.replace(/\s*고객님?\s*$/, "").trim();

/** 고객 한 명 몫의 값 (내 정보는 기기에 저장된 값) */
const valuesFor = customerName => ({ customerName, ...(store.profile || {}) });

/**
 * @param {HTMLElement} root
 * @param {object} template
 * @param {{templates:Array, upcoming:Array}} catalog
 * @param {{goHome:Function, openTemplate:Function}} nav
 */
export function renderEditor(root, template, catalog, nav) {
  const choice = store.choiceFor(template);
  const usesCustomer = template.fields.includes("customerName");
  const isDraft = template.status === "draft";
  let done = null;   // 저장 후: { kind, count, first, shared }

  root.innerHTML = `
    <div class="editor">
        <div class="panel__top">
          <button type="button" class="back" data-action="home">‹ 다른 DM 보기</button>
          <h1 class="panel__title"><span class="highlight">${escapeHtml(template.title)}</span></h1>
        </div>

      <section class="preview" aria-label="미리보기">
        <div class="preview__nav" aria-live="polite"></div>
        <div class="preview__frame"><canvas class="preview__canvas" role="img" aria-label="DM 미리보기"></canvas></div>
      </section>
      <section class="panel">
        <div class="panel__body"></div>
        <div class="save">
          ${isDraft
            ? `<p class="notice notice--draft">아직 <b>시안</b>이라 저장은 막아 두었어요.</p>`
            : `<div class="save__buttons">
                <button type="button" class="btn btn--save" data-save="jpg"><strong>DM 이미지 다운로드</strong><svg class="download-icon" viewBox="0 0 40 28" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 4v12m-6-6 6 6 6-6M4 19v5h32v-5"/></svg></button>
              </div>`}
          <p class="save__note">* 입력한 고객별 DM 이미지가 생성됩니다.</p>
        </div>
      </section>
    </div>`;

  const editor = root.querySelector(".editor");
  const body = root.querySelector(".panel__body");
  const canvas = root.querySelector(".preview__canvas");
  const navBox = root.querySelector(".preview__nav");

  /* ----- 미리보기: 마지막 요청만 그립니다 ----- */
  let drawTicket = 0;
  async function drawPreview() {
    const ticket = ++drawTicket;
    const names = store.customerNames;
    const index = Math.min(store.previewIndex, Math.max(names.length - 1, 0));
    store.setPreviewIndex(index);
    const current = names[index] || "";
    navBox.innerHTML = names.length > 1
      ? `<button type="button" class="icon-btn" data-step="-1" aria-label="이전 고객">‹</button>
         <span><b>${escapeHtml(current)}</b> 고객님 <em>${index + 1}/${names.length}</em></span>
         <button type="button" class="icon-btn" data-step="1" aria-label="다음 고객">›</button>`
      : `<span>${current ? `<b>${escapeHtml(current)}</b> 고객님` : ""}</span>`;
    const width = canvas.parentElement.clientWidth || 320;
    const scale = Math.min(2, (width * (window.devicePixelRatio || 1)) / template.size.width);
    const offscreen = document.createElement("canvas");
    try {
      await renderDM(offscreen, template, valuesFor(current), { ...choice, scale, preview: true, placeholders: PLACEHOLDERS });
    } catch (error) {
      console.error(error);
      return toast("미리보기를 그리지 못했어요. 인터넷 연결을 확인해 주세요");
    }
    if (ticket !== drawTicket) return;   // 그 사이 새 입력이 있었으면 버림
    canvas.width = offscreen.width;
    canvas.height = offscreen.height;
    canvas.getContext("2d").drawImage(offscreen, 0, 0);
    markSelectedRow();
  }

  /* ----- 고객 이름 칸 ----- */
  function customersHtml() {
    const profile = store.profile || {};
    return `
      <div class="sender"><div class="sender__info"><span class="sender__label">보내는 사람</span><b class="sender__identity">${escapeHtml(profile.agentName || "")}<span class="pc-only"> FA</span> · ${escapeHtml(profile.agentPhone || "")}</b></div>
        <button type="button" class="btn btn--text btn--sm" data-action="profile">+ 정보수정</button></div>
      ${usesCustomer ? `
      <div class="customers">
        <div class="customers__head"><strong id="customers-title">받는 고객</strong><b class="count" hidden></b></div>
        <ol class="customers__list" aria-labelledby="customers-title"></ol>
        <div class="customers__actions">
          <button type="button" class="btn btn--dashed" data-action="add">＋ 고객 추가</button>
        </div>
        <p class="field__error" id="customers-error" role="alert" hidden>고객 이름을 한 명 이상 적어 주세요.</p>
      </div>` : ""}`;
  }

  function drawRows(focusIndex) {
    const list = body.querySelector(".customers__list");
    if (!list) return;
    const rows = store.customers;
    list.innerHTML = rows.map((name, i) => `
      <li class="customer">
        <span class="customer__no" aria-hidden="true">${i + 1}</span>
        <input class="input customer__input" data-index="${i}" value="${escapeHtml(name)}" maxlength="${FIELDS.customerName.maxLength}"
          placeholder="고객 이름을 입력하세요" aria-label="고객 ${i + 1} 이름" autocomplete="off" enterkeyhint="next">
        <button type="button" class="icon-btn" data-remove="${i}" aria-label="고객 ${i + 1} 빼기" ${rows.length === 1 && !name ? "hidden" : ""}>✕</button>
      </li>`).join("");
    updateCount();
    if (focusIndex !== undefined) {
      const input = list.querySelector(`[data-index="${focusIndex}"]`);
      input?.focus();
      input?.scrollIntoView({ block: "nearest" });
    }
  }

  function updateCount() {
    const count = body.querySelector(".count");
    if (!count) return;
    const n = store.customerNames.length;
    count.hidden = !n;
    count.textContent = `(${n}명)`;
  }

  function markSelectedRow() {
    let k = -1;
    body.querySelectorAll(".customer").forEach(row => {
      const filled = row.querySelector("input").value.trim();
      if (filled) k++;
      row.classList.toggle("is-selected", !!filled && k === store.previewIndex);
    });
  }

  function insertMany(at, text) {
    const names = text.split(/[,\n\t·]+/).map(cleanName).filter(Boolean);
    if (!names.length) return;
    const rows = store.customers;
    const keep = rows[at]?.trim() ? [rows[at]] : [];
    store.setCustomers([...rows.slice(0, at), ...keep, ...names, ...rows.slice(at + 1).filter(n => n.trim())]);
    body.querySelector("#customers-error").hidden = true;
    drawRows();
    drawPreview();
  }

  /* ----- 저장 후 ----- */
  function doneHtml() {
    const others = catalog.templates.filter(t => t.id !== template.id && t.status === "published").sort((a,b) => b.uploadedAt.localeCompare(a.uploadedAt)).slice(0, 2);
    const what = done.kind === "jpg" ? `사진 저장 완료 (${done.count}장)` : `PPT 저장 완료 (${done.count}개)`;
    return `
      <div class="notice notice--done" role="status"><span>✓ ${what}</span></div>
      <div class="reco">
        ${others.length ? `<h2 class="reco__title">이런 DM은 어떠세요?</h2>
        <div class="reco__list">${others.map(t => cardHtml(t, { compact: true })).join("")}</div>` : ""}
        <button type="button" class="btn btn--home btn--block" data-action="all">전체 DM 보기 <span aria-hidden="true">→</span></button>
      </div>`;
  }

  function paintBody() {
    editor.classList.toggle("is-done", !!done);
    body.innerHTML = done ? doneHtml() : customersHtml();
    if (!done) drawRows();
  }

  /* ----- 저장 ----- */
  async function save(kind, buttons) {
    const names = usesCustomer ? store.customerNames : [""];
    if (!names.length) {
      if (done) { done = null; paintBody(); }
      body.querySelector("#customers-error").hidden = false;
      const first = body.querySelector(".customer__input");
      first.classList.add("is-invalid");
      first.focus();
      return;
    }
    const labels = buttons.map(b => b.querySelector("strong").innerHTML);
    setBusy(buttons, true);
    try {
      const result = await createAndSave(kind, template, names.map(valuesFor), choice, (n, total) => {
        buttons.forEach(b => { b.querySelector("strong").textContent = total > 1 ? `만드는 중… ${n}/${total}` : "만드는 중…"; });
      });
      if (result.status === "cancelled") return toast("저장을 취소했어요");
      if (result.status === "failed") return toast("저장하지 못했어요. 잠시 후 다시 눌러 주세요");
      store.addRecent(template.id);
      track("dm_download", { template: template.id, format: kind, count: result.count, background: choice.background, logo: choice.logo });
      done = { kind, count: result.count, first: names[0], shared: result.status === "shared" };
      paintBody();
      if (kind === "pptx" && !result.filled) toast("이 기기에서는 이름을 넣지 못해 원본 PPT로 저장했어요");
    } catch (error) {
      console.error(error);
      toast("만들지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요");
    } finally {
      setBusy(buttons, false);
      buttons.forEach((b, i) => { b.querySelector("strong").innerHTML = labels[i]; });
    }
  }

  /* ----- 이벤트: 화면 바깥 상자 하나에서 처리 ----- */
  editor.addEventListener("click", event => {
    const target = event.target.closest("button");
    if (!target) return;
    const { action, step, remove, save: kind, open } = target.dataset;
    if (action === "home") return nav.goHome();
    if (action === "all") return nav.goHome(true);
    if (action === "profile") return openProfileModal({ first: false, onSaved: () => { paintBody(); drawPreview(); } });
    if (action === "add") {
      const empty = store.customers.findIndex(n => !n.trim());
      if (empty < 0) store.setCustomers([...store.customers, ""]);
      return drawRows(empty < 0 ? store.customers.length - 1 : empty);
    }
    if (step) {
      const n = store.customerNames.length;
      store.setPreviewIndex((store.previewIndex + Number(step) + n) % n);
      return drawPreview();
    }
    if (remove !== undefined) {
      const rows = store.customers.filter((_, i) => i !== Number(remove));
      store.setCustomers(rows);
      drawRows();
      return drawPreview();
    }
    if (kind) return save(kind, [...editor.querySelectorAll(`[data-save="${kind}"]`)]);
    if (open) return nav.openTemplate(open);
  });

  body.addEventListener("input", event => {
    const input = event.target.closest(".customer__input");
    if (!input) return;
    const rows = [...store.customers];
    rows[Number(input.dataset.index)] = input.value;
    store.setCustomers(rows);
    input.classList.remove("is-invalid");
    body.querySelector("#customers-error").hidden = true;
    body.querySelector(`[data-remove="${input.dataset.index}"]`)?.removeAttribute("hidden");
    selectRow(Number(input.dataset.index));
    updateCount();
    drawPreview();
  });
  body.addEventListener("focusin", event => {
    const input = event.target.closest(".customer__input");
    if (input && input.value.trim()) { selectRow(Number(input.dataset.index)); drawPreview(); }
  });
  body.addEventListener("keydown", event => {
    const input = event.target.closest(".customer__input");
    if (!input || event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    if (!input.value.trim()) return;
    const i = Number(input.dataset.index);
    if (i === store.customers.length - 1) { store.setCustomers([...store.customers, ""]); drawRows(i + 1); }
    else body.querySelector(`[data-index="${i + 1}"]`).focus();
  });
  body.addEventListener("paste", event => {
    const input = event.target.closest(".customer__input");
    const text = event.clipboardData?.getData("text") || "";
    if (!input || !/[,\n\t·]/.test(text)) return;
    event.preventDefault();
    insertMany(Number(input.dataset.index), text);
  });
  function selectRow(i) {
    if (!store.customers[i]?.trim()) return;
    store.setPreviewIndex(store.customers.slice(0, i).filter(n => n.trim()).length);
  }

  paintBody();
  drawPreview();
}
