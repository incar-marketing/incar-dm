/**
 * admin/js/form.js — DM 한 개 등록 · 수정 화면
 *
 * 흐름: 원래 template.json 을 복사 → 입력칸 값으로 고치기 → 사용자 화면과 같은 검사(validate) → 변경 묶음 저장
 * 입력칸에 없는 설정(keywords, pptText, logo 등)은 손대지 않고 그대로 다시 저장합니다.
 * 미리보기는 사용자 화면과 같은 renderDM 으로 그려서, 저장될 DM과 똑같이 보입니다.
 * 새 DM은 templates/_sample/template.json 을 시작 값으로 씁니다.
 */
import { FIELDS, FONTS, STATUSES, NEW_DAYS, validate, fetchJSON } from "../../assets/js/templates.js?v=20261127b";
import { renderDM } from "../../assets/js/renderer.js?v=20261127b";
import { escapeHtml, setBusy, toast } from "../../assets/js/ui.js?v=20261127b";
import { saveChanges, jsonFile } from "./api.js?v=20261127b";
import { confirmDialog } from "./dialog.js?v=20261127b";
import { readPptLayout } from "./pptx.js?v=20261127b";
import { prepareBackground, eraseMarks, makeThumbnail, blobToBase64, IMAGE_RULES } from "./images.js?v=20261127b";

export const STATUS_LABEL = { published: "공개", draft: "시안", hidden: "비공개" };
const STATUS_HINT = { published: "목록에 보이고 저장할 수 있어요", draft: "목록에 '시안'으로 보이고 저장은 막혀요", hidden: "목록에서 빠져요" };
const FONT_LABEL = { suit: "SUIT (고딕)", buri: "아리따 부리", dotum: "아리따 돋움", script: "필기체" };
const ALIGN_LABEL = { left: "왼쪽 기준", center: "가운데 기준", right: "오른쪽 기준" };
const WEIGHTS = [400, 700, 800];
/** 미리보기·썸네일에 넣는 예시 값 (실제 개인정보를 쓰지 않습니다) */
const SAMPLE = { customerName: "홍길동", agentName: "김인카", agentPhone: "010.1234.5678" };
const DM_WIDTH = 800;   // 글자 위치(x·y)를 재는 기준 폭
const FOLDER_RULE = /^[a-z0-9][a-z0-9-]*$/;
const NUMBER_KEYS = ["x", "y", "size", "maxWidth", "letterSpacing", "weight"];
const OPTIONAL_KEYS = ["maxWidth", "letterSpacing"];   // 비우면 설정에서 뺍니다

const today = () => new Date().toLocaleDateString("sv-SE");   // "2026-11-25"
const newMode = showNew => (showNew === true ? "on" : showNew === false ? "off" : "auto");

/** 화면용으로 붙은 값(id·folder·order)을 빼고 template.json 내용만 남깁니다 */
function fileData(template) {
  const { id, folder, order, ...data } = template;
  return structuredClone(data);
}

/**
 * @param {HTMLElement} root
 * @param {object} options
 * @param {object} options.manifest      templates/manifest.json
 * @param {Array}  options.templates     불러온 DM 목록
 * @param {object|null} options.template 고칠 DM (새 DM이면 null)
 * @param {Function} options.onDone      저장 후 / 목록으로
 */
export async function renderForm(root, { manifest, templates, template, onDone }) {
  const isNew = !template;
  const draft = isNew ? await fetchJSON("templates/_sample/template.json") : fileData(template);
  if (isNew) {
    Object.assign(draft, { title: "", uploadedAt: today(), status: "draft", themes: [], keywords: [] });
    delete draft.showNew;   // NEW 는 기본 '자동'(업로드 날짜부터 NEW_DAYS 일)
    // 본(_sample)의 로고·PPT 자리는 새 DM에 파일이 없으므로 뺍니다 (로고는 배경 그림에 넣어 두세요)
    delete draft.logo;
    delete draft.pptText;
    delete draft.backgrounds[0].ppt;
  }
  const themeIds = new Set(manifest.themes.map(theme => theme.id));
  let folder = template?.folder || "";
  let newBackground = null;   // 새로 올린 배경 { blob, url, width, height }
  let newPpt = null;          // 새로 올린 PPT 파일과 읽은 값 { file, ratio, pptText, marks }
  let cleanedBackground = null; // 표시 글자를 지운 배경 { blob, url, width, height }
  let eraseOn = true;           // '배경 그림에 찍힌 표시 지우기'
  let selected = 0;           // 미리보기를 누르면 옮겨질 글자 줄
  let dirty = false;

  root.innerHTML = `
    <form class="dm-form" novalidate>
      <div class="admin-section__head">
        <button type="button" class="link" data-back>‹ DM 목록</button>
        <h1 class="admin-title">${isNew ? "새 DM 등록" : "DM 수정"}</h1>
      </div>
      <div class="dm-form__layout">
        <div class="dm-form__fields">
          <section class="form-card">
            <h2 class="form-card__title">기본 정보</h2>
            <div class="field"><label for="f-title">DM 제목</label>
              <input class="input" id="f-title" name="title" maxlength="40" value="${escapeHtml(draft.title)}"></div>
            ${isNew ? `<div class="field"><label for="f-folder">폴더 이름 (주소)</label>
              <input class="input" id="f-folder" name="folder" placeholder="예) 2026-12-yearend" autocomplete="off" spellcheck="false">
              <span class="field__hint">영어 소문자 · 숫자 · '-'만 쓸 수 있어요. 등록한 뒤에는 바꿀 수 없어요.</span></div>` : ""}
            <div class="form-grid">
              <div class="field"><label for="f-date">업로드 날짜</label>
                <input class="input" id="f-date" name="uploadedAt" type="date" value="${escapeHtml(draft.uploadedAt)}"></div>
              <div class="field"><label for="f-file">저장 파일 이름</label>
                <input class="input" id="f-file" name="fileName" maxlength="30" value="${escapeHtml(draft.fileName || "")}">
                <span class="field__hint">설계사가 받는 파일 이름 앞부분이에요.</span></div>
            </div>
          </section>

          <section class="form-card">
            <h2 class="form-card__title">노출 설정</h2>
            <fieldset class="field"><legend>카테고리 (여러 개 고를 수 있어요)</legend>
              <div class="check-row">${manifest.themes.map(theme => `<label class="check"><input type="checkbox" name="themes" value="${escapeHtml(theme.id)}" ${draft.themes.includes(theme.id) ? "checked" : ""}> ${escapeHtml(theme.name)}</label>`).join("")}</div>
            </fieldset>
            <fieldset class="field"><legend>공개 상태</legend>
              <div class="check-row">${STATUSES.map(status => `<label class="check"><input type="radio" name="status" value="${status}" ${draft.status === status ? "checked" : ""}> ${STATUS_LABEL[status]}</label>`).join("")}</div>
              <span class="field__hint" data-status-hint>${STATUS_HINT[draft.status]}</span>
            </fieldset>
            <fieldset class="field"><legend>NEW 표시</legend>
              <div class="check-row">${[["auto", `자동 (업로드 날짜부터 ${NEW_DAYS}일)`], ["on", "항상 표시"], ["off", "표시 안 함"]].map(([value, label]) =>
                `<label class="check"><input type="radio" name="showNew" value="${value}" ${value === newMode(draft.showNew) ? "checked" : ""}> ${label}</label>`).join("")}</div>
            </fieldset>
          </section>

          <section class="form-card">
            <h2 class="form-card__title">배경 그림</h2>
            <div class="field"><label for="f-bg">${isNew ? "배경 그림 올리기" : "배경 그림 바꾸기"}</label>
              <input class="input input--file" id="f-bg" type="file" accept="image/jpeg,image/png,image/webp">
              <span class="field__hint">이름·연락처 자리를 비워 둔 그림을 올려 주세요. 가로 ${IMAGE_RULES.backgroundWidth}px을 권장하고, 더 크면 자동으로 줄여요. 목록용 작은 그림(썸네일)은 저장할 때 미리보기로 자동으로 만들어져요.</span></div>
            <div class="field"><label for="f-ppt">PPT 파일 (선택)</label>
              <input class="input input--file" id="f-ppt" type="file" accept=".pptx">
              <span class="field__hint">PPT의 이름 자리에 <b>{고객명} {설계사}(또는 {설계사명}) 010.0000.0000(또는 {연락처})</b>를 적어 두면, 그 위치·크기·색을 읽어 아래 글자 자리를 자동으로 채워요. 같은 PPT로 설계사의 PPT 저장도 돼요.${draft.backgrounds[0].ppt ? ` (지금 파일: ${escapeHtml(draft.backgrounds[0].ppt)})` : ""}</span>
              <label class="check"><input type="checkbox" name="eraseMarkers" checked> 배경 그림에 찍힌 표시 글자는 자동으로 지우기</label>
              <span class="field__hint">PPT를 그대로 내보낸 그림을 올려도 돼요. 표시 양옆 색으로 채워서 단색·그라데이션 배경에서는 깔끔해요. 사진·무늬 위라 티가 나면 끄고, 표시를 지운 그림을 올려 주세요.</span></div>
          </section>

          <section class="form-card">
            <h2 class="form-card__title">글자 자리</h2>
            <p class="field__hint">위치(x·y)는 DM 가로 ${DM_WIDTH} 기준이에요. 줄을 고른 뒤 오른쪽 미리보기를 누르면 그 자리로 옮겨져요.</p>
            <div class="text-lines"></div>
            <button type="button" class="btn btn--dashed btn--block" data-add-line>+ 글자 줄 추가</button>
          </section>
        </div>

        <aside class="dm-form__preview">
          <div class="preview-box">
            <canvas class="preview-box__canvas" aria-label="DM 미리보기"></canvas>
            <p class="preview-box__empty" hidden>배경 그림을 올리면 미리보기가 보여요.</p>
          </div>
          <p class="field__hint">예시 값: ${Object.values(SAMPLE).map(escapeHtml).join(" · ")}</p>
        </aside>
      </div>

      <div class="form-errors" role="alert" hidden></div>
      <div class="dm-form__actions">
        <button type="button" class="btn" data-back>취소</button>
        <button type="submit" class="btn btn--primary">저장하기</button>
      </div>
    </form>`;

  const form = root.querySelector(".dm-form");
  const lines = form.querySelector(".text-lines");
  const canvas = form.querySelector(".preview-box__canvas");
  const errorBox = form.querySelector(".form-errors");

  /* ----- 글자 줄 ----- */
  const options = (list, labels, value) => list.map(item => `<option value="${item}" ${String(item) === String(value) ? "selected" : ""}>${labels ? labels[item] : item}</option>`).join("");
  const numberField = (label, key, item, step = 1) =>
    `<label class="mini-field">${label}<input class="input input--sm" type="number" step="${step}" data-key="${key}" value="${item[key] ?? ""}"></label>`;

  function drawLines() {
    lines.innerHTML = draft.texts.map((item, i) => `
      <fieldset class="text-line" data-line="${i}" ${i === selected ? 'aria-current="true"' : ""}>
        <legend>줄 ${i + 1}</legend>
        <div class="text-line__top">
          <input class="input input--sm" data-key="text" value="${escapeHtml(item.text)}" aria-label="줄 ${i + 1} 내용">
          <button type="button" class="icon-btn" data-remove-line aria-label="줄 ${i + 1} 삭제">✕</button>
        </div>
        <div class="token-row">${Object.entries(FIELDS).map(([key, field]) => `<button type="button" class="btn btn--sm" data-token="${key}">+ ${field.label}</button>`).join("")}</div>
        <div class="text-line__grid">
          ${numberField("x", "x", item, 0.1)}${numberField("y", "y", item, 0.1)}${numberField("크기", "size", item, 0.1)}
          ${numberField("최대 폭", "maxWidth", item)}${numberField("자간", "letterSpacing", item, 0.1)}
          <label class="mini-field">정렬<select class="input input--sm" data-key="align">${options(Object.keys(ALIGN_LABEL), ALIGN_LABEL, item.align || "left")}</select></label>
          <label class="mini-field">글꼴<select class="input input--sm" data-key="font">${options(FONTS, FONT_LABEL, item.font)}</select></label>
          <label class="mini-field">굵기<select class="input input--sm" data-key="weight">${options(WEIGHTS, null, item.weight || 400)}</select></label>
          <label class="mini-field">색<input class="input input--sm input--color" type="color" data-key="color" value="${escapeHtml(item.color || "#000000")}"></label>
        </div>
      </fieldset>`).join("");
  }

  function selectLine(index) {
    selected = index;
    lines.querySelectorAll(".text-line").forEach(line => line.toggleAttribute("aria-current", Number(line.dataset.line) === index));
    drawPreview();
  }

  /** renderDM 은 폴더 이름으로 그림 주소를 찾으므로, 저장용 draft 에 폴더를 붙여서 넘깁니다 */
  const forRender = () => ({ ...draft, folder });

  /* ----- 미리보기: 마지막 요청만 그립니다 ----- */
  let ticket = 0;
  async function drawPreview() {
    const mine = ++ticket;
    const hasBackground = !isNew || newBackground;
    form.querySelector(".preview-box__empty").hidden = !!hasBackground;
    canvas.hidden = !hasBackground;
    if (!hasBackground) return;
    const shown = document.createElement("canvas");
    try {
      await renderDM(shown, forRender(), SAMPLE, { background: draft.backgrounds[0].id, logo: "h", scale: 1, preview: true, placeholders: SAMPLE });
    } catch (error) {
      console.error(error);
      return;
    }
    if (mine !== ticket) return;
    // 고른 줄의 기준점을 표시 (저장되는 그림에는 들어가지 않음)
    const item = draft.texts[selected];
    if (item) {
      const ctx = shown.getContext("2d");
      ctx.strokeStyle = "#2463eb";
      ctx.lineWidth = 2;
      ctx.strokeRect(item.x - 6, item.y - 6, 12, 12);
    }
    canvas.width = shown.width;
    canvas.height = shown.height;
    canvas.getContext("2d").drawImage(shown, 0, 0);
  }

  /* ----- 입력 → draft ----- */
  function readLineInput(input) {
    const item = draft.texts[Number(input.closest(".text-line").dataset.line)];
    const key = input.dataset.key;
    if (NUMBER_KEYS.includes(key)) {
      const value = parseFloat(input.value);
      if (Number.isFinite(value)) item[key] = value;
      else if (OPTIONAL_KEYS.includes(key)) delete item[key];
    } else {
      item[key] = input.value;
    }
  }

  function readTopInput(input) {
    if (input.name === "themes") draft.themes = [...form.querySelectorAll('[name="themes"]:checked')].map(box => box.value);
    else if (input.name === "showNew") {   // 자동이면 showNew 를 빼서 날짜로 정합니다
      if (input.value === "auto") delete draft.showNew;
      else draft.showNew = input.value === "on";
    }
    else if (input.name === "status") {
      draft.status = input.value;
      form.querySelector("[data-status-hint]").textContent = STATUS_HINT[input.value];
    } else if (input.name === "folder") folder = input.value.trim();
    else if (input.name === "eraseMarkers") { eraseOn = input.checked; refreshBackground(); }
    else if (input.name) draft[input.name] = input.value.trim();
  }

  form.addEventListener("input", event => {
    const input = event.target;
    if (input.type === "file") return;
    dirty = true;
    if (input.dataset.key) readLineInput(input);
    else readTopInput(input);
    drawPreview();
  });

  /** 배경 그림과 PPT 슬라이드의 세로/가로 비율이 다르면 글자 위치가 어긋나므로 알려 줍니다 */
  function warnIfRatioDiffers() {
    if (!newPpt) return;
    const imageRatio = draft.size.height / draft.size.width;
    if (Math.abs(imageRatio - newPpt.ratio) / newPpt.ratio > 0.02) toast("배경 그림과 PPT 슬라이드의 비율이 달라요. 같은 PPT에서 내보낸 그림인지 확인해 주세요");
  }

  /** 미리보기·저장에 쓸 배경: PPT 표시를 지운 그림 > 새로 올린 그림 > 원래 그림 */
  async function refreshBackground() {
    if (cleanedBackground) URL.revokeObjectURL(cleanedBackground.url);
    cleanedBackground = null;
    if (newPpt && eraseOn && (newBackground || !isNew)) {
      try {
        const source = newBackground?.blob || await fetch(`templates/${folder}/${draft.backgrounds[0].file}`, { cache: "no-cache" }).then(r => r.blob());
        cleanedBackground = await eraseMarks(source, newPpt.marks, DM_WIDTH);
      } catch (error) {
        console.error(error);
        toast("배경 그림의 표시를 지우지 못했어요. 표시를 지운 그림을 올려 주세요");
      }
    }
    const shown = cleanedBackground || newBackground;
    if (shown) draft.backgrounds[0].src = shown.url;
    else delete draft.backgrounds[0].src;
    drawPreview();
  }

  async function usePpt(file) {
    const layout = await readPptLayout(file, DM_WIDTH);
    if (!layout.texts.length) throw new Error("PPT에서 {고객명} · {설계사명} · {연락처} 표시를 찾지 못했어요. 이름 자리에 이 표시를 적어 주세요");
    newPpt = { file, ratio: layout.ratio, pptText: layout.pptText, marks: layout.marks };
    draft.texts = layout.texts;
    selected = 0;
    dirty = true;
    drawLines();
    await refreshBackground();
    // {설계사}·010.0000.0000 처럼 다른 글자로 표시한 자리는 '없는 표시'에서 뺍니다
    const aliasFor = { "{설계사명}": "{agentName}", "{연락처}": "{agentPhone}" };
    const missing = layout.missing.filter(token => !Object.values(layout.pptText).includes(aliasFor[token]));
    toast(`PPT에서 글자 자리 ${layout.texts.length}개를 읽었어요. 미리보기로 확인해 주세요${missing.length ? ` (없는 표시: ${missing.join(" ")})` : ""}`);
    if (!isNew || newBackground) warnIfRatioDiffers();
  }

  form.addEventListener("change", async event => {
    if (event.target.type !== "file" || !event.target.files[0]) return;
    try {
      if (event.target.id === "f-ppt") return await usePpt(event.target.files[0]);
      const prepared = await prepareBackground(event.target.files[0]);
      if (newBackground) URL.revokeObjectURL(newBackground.url);
      newBackground = prepared;
      // 글자 위치는 가로 800 기준이라, 세로는 그림 비율에 맞춥니다
      draft.size = { width: DM_WIDTH, height: Math.round(DM_WIDTH * prepared.height / prepared.width) };
      dirty = true;
      await refreshBackground();
      warnIfRatioDiffers();
    } catch (error) {
      event.target.value = "";
      showErrors([error.message]);
    }
  });

  form.addEventListener("focusin", event => {
    const line = event.target.closest(".text-line");
    if (line && Number(line.dataset.line) !== selected) selectLine(Number(line.dataset.line));
  });

  form.addEventListener("click", event => {
    const target = event.target;
    if (target.closest("[data-back]")) {
      if (!dirty) onDone(false);
      else confirmDialog({ title: "저장하지 않고 나갈까요?", message: "고친 내용이 사라져요.", ok: "나가기", onOk: () => onDone(false) });
      return;
    }
    if (target.closest("[data-add-line]")) {
      draft.texts.push({ text: "{customerName}", x: DM_WIDTH / 2, y: 100, font: "suit", size: 32, weight: 700, color: "#000000", align: "center" });
      selected = draft.texts.length - 1;
      dirty = true;
      drawLines();
      drawPreview();
      return;
    }
    const line = target.closest(".text-line");
    if (target.closest("[data-remove-line]")) {
      draft.texts.splice(Number(line.dataset.line), 1);
      selected = Math.max(0, Math.min(selected, draft.texts.length - 1));
      dirty = true;
      drawLines();
      drawPreview();
      return;
    }
    const token = target.closest("[data-token]");
    if (token) {   // 글자 칸 커서 자리에 {customerName} 같은 표시를 넣습니다
      const input = line.querySelector('[data-key="text"]');
      const at = input.selectionStart ?? input.value.length;
      input.setRangeText(`{${token.dataset.token}}`, at, input.selectionEnd ?? at, "end");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
      return;
    }
    if (target === canvas && draft.texts[selected]) {   // 미리보기를 누른 자리로 고른 줄을 옮김
      const rect = canvas.getBoundingClientRect();
      const scale = draft.size.width / rect.width;
      Object.assign(draft.texts[selected], {
        x: Math.round((event.clientX - rect.left) * scale * 10) / 10,
        y: Math.round((event.clientY - rect.top) * scale * 10) / 10
      });
      dirty = true;
      drawLines();
      drawPreview();
    }
  });

  /* ----- 저장 ----- */
  function showErrors(messages) {
    errorBox.hidden = !messages.length;
    errorBox.innerHTML = messages.length ? `<strong>확인해 주세요</strong><ul>${messages.map(m => `<li>${escapeHtml(m)}</li>`).join("")}</ul>` : "";
    if (messages.length) errorBox.scrollIntoView({ block: "center" });
  }

  function check() {
    const problems = [];
    if (isNew) {
      if (!FOLDER_RULE.test(folder)) problems.push("폴더 이름은 영어 소문자 · 숫자 · '-'로 적어 주세요");
      else if (manifest.templates.some(entry => entry.folder === folder)) problems.push("같은 폴더 이름이 이미 있어요");
      if (!newBackground) problems.push("배경 그림을 올려 주세요");
    }
    if (!draft.texts.length) problems.push("글자 줄이 하나 이상 있어야 해요");
    return problems.concat(validate(draft, themeIds));
  }

  async function buildChanges() {
    const dir = `templates/${folder}/`;
    const write = [];
    const remove = [];
    // 썸네일: 예시 값을 넣은 실제 DM 모양 (노란 표시 없이)
    const full = await renderDM(document.createElement("canvas"), forRender(), SAMPLE, { background: draft.backgrounds[0].id, logo: "h", preview: false });
    write.push({ path: `${dir}thumb.jpg`, base64: await blobToBase64(await makeThumbnail(full)) });

    const saved = structuredClone(draft);
    saved.thumbnail = "thumb.jpg";
    delete saved.backgrounds[0].src;
    const finalBackground = cleanedBackground || newBackground;
    if (finalBackground) {
      const oldFile = saved.backgrounds[0].file;
      saved.backgrounds[0].file = "bg.jpg";
      write.push({ path: `${dir}bg.jpg`, base64: await blobToBase64(finalBackground.blob) });
      // 예전 배경 파일 이름이 달랐고 다른 배경이 쓰지 않으면 지웁니다
      if (!isNew && oldFile !== "bg.jpg" && !saved.backgrounds.some(bg => bg.file === oldFile)) remove.push(`${dir}${oldFile}`);
    }
    if (newPpt) {
      const oldPpt = saved.backgrounds[0].ppt;
      saved.backgrounds[0].ppt = "dm.pptx";
      // 예전 PPT용 글자 바꾸기는 버리고, 이번 PPT에서 찾은 글자(010.0000.0000 등)만 남깁니다
      if (Object.keys(newPpt.pptText).length) saved.pptText = newPpt.pptText;
      else delete saved.pptText;
      write.push({ path: `${dir}dm.pptx`, base64: await blobToBase64(newPpt.file) });
      if (!isNew && oldPpt && oldPpt !== "dm.pptx" && !saved.backgrounds.some(bg => bg.ppt === oldPpt)) remove.push(`${dir}${oldPpt}`);
    }
    write.push(jsonFile(`${dir}template.json`, saved));
    if (isNew) write.push(jsonFile("templates/manifest.json", { ...manifest, templates: [{ folder }, ...manifest.templates] }));
    return { message: `${isNew ? "DM 등록" : "DM 수정"}: ${saved.title} (${folder})`, write, remove };
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    // 글자에 쓰인 표시({customerName} 등)로 입력 항목을 정합니다 → 따로 관리할 필요 없음
    draft.fields = Object.keys(FIELDS).filter(key => draft.texts.some(item => item.text.includes(`{${key}}`)));
    const problems = check();
    showErrors(problems);
    if (problems.length) return;
    const button = form.querySelector('[type="submit"]');
    setBusy([button], true);
    try {
      await saveChanges(await buildChanges());
      dirty = false;
      onDone(true);
    } catch (error) {
      showErrors([error.message]);
    } finally {
      setBusy([button], false);
    }
  });

  drawLines();
  drawPreview();
  return () => dirty;   // 목록으로 나갈 때 저장 안 한 내용이 있는지 확인용
}
