/**
 * admin/js/main.js — 관리자 페이지 시작점
 *   #/             DM 목록 (순서 바꾸기 · 삭제)
 *   #/categories   카테고리
 *   #/new          새 DM 등록
 *   #/edit/<폴더>   DM 수정
 *
 * 데이터는 사용자 화면과 같은 파일(templates/manifest.json, 각 template.json)을 그대로 읽고 씁니다.
 * 저장은 api.js → 관리자 서버(worker/) → GitHub 커밋. 저장에 성공하면 새로 불러와 최신 상태를 보여 줍니다.
 */
import { loadCatalog, fetchJSON, assetUrl, isNew } from "../../assets/js/templates.js?v=20261127c";
import { escapeHtml, toast, setBusy } from "../../assets/js/ui.js?v=20261127c";
import { saveChanges, jsonFile } from "./api.js?v=20261127c";
import { renderForm, STATUS_LABEL } from "./form.js?v=20261127c";
import { confirmDialog } from "./dialog.js?v=20261127c";

const app = document.getElementById("admin");
const NOTICE_KEY = "dmstudio.admin.notice";
const MANIFEST = "templates/manifest.json";

let manifest = null;      // 저장된 manifest.json
let templates = [];       // 불러온 DM (비공개 포함)
let order = null;         // 순서를 바꾸는 중이면 폴더 이름 목록 (저장 전)
let themes = null;        // 카테고리를 고치는 중이면 그 목록 (저장 전)
let hasUnsaved = null;    // DM 등록·수정 화면이면 '저장 안 한 내용이 있는지' 알려 주는 함수

const go = hash => { location.hash = hash; };

/** 저장 성공 → 새로 고침 (이미지·설정을 모두 최신으로 다시 받기 위해) */
function afterSave(message = "저장했어요. 사이트에는 1~2분 뒤 반영돼요") {
  try { sessionStorage.setItem(NOTICE_KEY, message); } catch { /* 알림만 못 보여 줌 */ }
  location.hash = "#/";
  location.reload();
}

async function commit(changes, button) {
  if (button) setBusy([button], true);
  try {
    await saveChanges(changes);
    afterSave();
  } catch (error) {
    toast(error.message);
  } finally {
    if (button) setBusy([button], false);
  }
}

const tabsHtml = current => `
  <nav class="admin-tabs" aria-label="관리 메뉴">
    <a class="admin-tabs__item" href="admin/#/" ${current === "list" ? 'aria-current="page"' : ""}>DM 목록</a>
    <a class="admin-tabs__item" href="admin/#/categories" ${current === "categories" ? 'aria-current="page"' : ""}>카테고리</a>
  </nav>`;

const moveButtons = (index, last, kind) => `
  <div class="order-buttons">
    <button type="button" class="icon-btn" data-move="-1" data-kind="${kind}" data-index="${index}" aria-label="위로" ${index === 0 ? "disabled" : ""}>↑</button>
    <button type="button" class="icon-btn" data-move="1" data-kind="${kind}" data-index="${index}" aria-label="아래로" ${index === last ? "disabled" : ""}>↓</button>
  </div>`;

const swap = (list, index, step) => {
  const to = index + step;
  if (to < 0 || to >= list.length) return;
  [list[index], list[to]] = [list[to], list[index]];
};

/* ---------- DM 목록 ---------- */
function renderList() {
  const folders = order || manifest.templates.map(entry => entry.folder);
  const byFolder = new Map(templates.map(t => [t.folder, t]));
  const themeName = id => manifest.themes.find(theme => theme.id === id)?.name || id;

  app.innerHTML = `
    ${tabsHtml("list")}
    <section class="admin-section">
      <div class="admin-section__head">
        <h1 class="admin-title">DM 목록 <small>${folders.length}개 · 위에 있을수록 사이트 앞쪽에 나와요</small></h1>
        <button type="button" class="btn btn--primary" data-go="#/new">+ 새 DM 등록</button>
      </div>
      ${folders.length ? `<ol class="dm-admin-list">${folders.map((folder, i) => {
        const t = byFolder.get(folder);
        const safeFolder = escapeHtml(folder);
        return `<li class="dm-admin-row">
          ${moveButtons(i, folders.length - 1, "dm")}
          ${t ? `
            <img class="dm-admin-row__thumb" src="${escapeHtml(assetUrl(t, t.thumbnail))}" alt="" loading="lazy">
            <div class="dm-admin-row__meta">
              <strong>${escapeHtml(t.title)}</strong>
              <small>${t.themes.map(themeName).map(escapeHtml).join(" · ")} · ${escapeHtml(t.uploadedAt)}</small>
            </div>
            <div class="dm-admin-row__state">
              <span class="state state--${t.status}">${STATUS_LABEL[t.status]}</span>
              ${isNew(t) ? `<span class="state state--new">NEW${typeof t.showNew === "boolean" ? "" : " (자동)"}</span>` : ""}
            </div>
            <button type="button" class="btn btn--sm" data-go="#/edit/${encodeURIComponent(folder)}">수정</button>` : `
            <div class="dm-admin-row__meta">
              <strong>불러오지 못한 DM</strong>
              <small>templates/${safeFolder} — 설정 파일에 문제가 있어요. 삭제하거나 파일을 고쳐 주세요.</small>
            </div>`}
          <button type="button" class="btn btn--sm btn--danger" data-delete="${safeFolder}">삭제</button>
        </li>`;
      }).join("")}</ol>` : `<div class="empty"><strong>등록된 DM이 없어요.</strong></div>`}
      ${order ? `<div class="save-bar" role="status">
        <span>순서를 바꿨어요. 저장해야 사이트에 반영돼요.</span>
        <button type="button" class="btn btn--sm" data-order-reset>되돌리기</button>
        <button type="button" class="btn btn--sm btn--primary" data-order-save>순서 저장</button>
      </div>` : ""}
    </section>`;
}

function deleteTemplate(folder) {
  const title = templates.find(t => t.folder === folder)?.title || folder;
  confirmDialog({
    title: `'${title}' DM을 삭제할까요?`,
    message: "이 DM의 그림과 설정이 모두 지워져요. 실수로 지웠다면 GitHub 기록에서 되살릴 수 있어요.",
    ok: "삭제하기",
    onOk: () => commit({
      message: `DM 삭제: ${title} (${folder})`,
      write: [jsonFile(MANIFEST, { ...manifest, templates: manifest.templates.filter(entry => entry.folder !== folder) })],
      remove: [`templates/${folder}/`]
    })
  });
}

function saveOrder(button) {
  const entries = new Map(manifest.templates.map(entry => [entry.folder, entry]));
  commit({ message: "DM 순서 변경", write: [jsonFile(MANIFEST, { ...manifest, templates: order.map(folder => entries.get(folder)) })] }, button);
}

/* ---------- 카테고리 ---------- */
function renderCategories() {
  themes ||= structuredClone(manifest.themes);
  const used = id => templates.filter(t => t.themes.includes(id)).length;
  app.innerHTML = `
    ${tabsHtml("categories")}
    <section class="admin-section">
      <div class="admin-section__head">
        <h1 class="admin-title">카테고리 <small>사이트 탭 순서대로 보여요</small></h1>
      </div>
      <ol class="dm-admin-list">${themes.map((theme, i) => `
        <li class="dm-admin-row">
          ${moveButtons(i, themes.length - 1, "theme")}
          <input class="input input--sm" data-theme-name="${i}" value="${escapeHtml(theme.name)}" maxlength="10" aria-label="카테고리 이름">
          <small class="dm-admin-row__count">DM ${used(theme.id)}개</small>
          <button type="button" class="btn btn--sm btn--danger" data-theme-delete="${i}" ${used(theme.id) ? 'disabled title="이 카테고리를 쓰는 DM이 있어 지울 수 없어요"' : ""}>삭제</button>
        </li>`).join("")}
      </ol>
      <button type="button" class="btn btn--dashed btn--block" data-theme-add>+ 카테고리 추가</button>
      <div class="dm-form__actions">
        <button type="button" class="btn" data-theme-reset>되돌리기</button>
        <button type="button" class="btn btn--primary" data-theme-save>카테고리 저장</button>
      </div>
    </section>`;
}

function saveThemes(button) {
  const names = themes.map(theme => theme.name.trim());
  if (names.some(name => !name)) return toast("카테고리 이름을 모두 적어 주세요");
  if (new Set(names).size !== names.length) return toast("같은 이름의 카테고리가 있어요");
  commit({ message: "카테고리 변경", write: [jsonFile(MANIFEST, { ...manifest, themes: themes.map((theme, i) => ({ ...theme, name: names[i] })) })] }, button);
}

/* ---------- 화면 전환 ---------- */
function route() {
  const hash = location.hash;
  const edit = hash.match(/^#\/edit\/(.+)$/);
  const onDone = saved => (saved ? afterSave() : go("#/"));
  window.scrollTo(0, 0);
  hasUnsaved = null;
  const openForm = template => renderForm(app, { manifest, templates, template, onDone }).then(check => { hasUnsaved = check; });
  if (hash === "#/new") return openForm(null);
  if (edit) {
    const template = templates.find(t => t.folder === decodeURIComponent(edit[1]));
    if (template) return openForm(template);
    toast("찾는 DM이 없어요");
  }
  if (hash === "#/categories") return renderCategories();
  renderList();
}

/* 클릭은 바깥 상자 하나에서 처리합니다 (화면을 다시 그려도 리스너가 늘지 않음) */
app.addEventListener("click", event => {
  const t = event.target.closest("button");
  if (!t) return;
  if (t.dataset.go) return go(t.dataset.go);
  if (t.dataset.move) {
    const step = Number(t.dataset.move), index = Number(t.dataset.index);
    if (t.dataset.kind === "dm") { order ||= manifest.templates.map(entry => entry.folder); swap(order, index, step); renderList(); }
    else { swap(themes, index, step); renderCategories(); }
    return;
  }
  if (t.dataset.delete) return deleteTemplate(t.dataset.delete);
  if ("orderReset" in t.dataset) { order = null; return renderList(); }
  if ("orderSave" in t.dataset) return saveOrder(t);
  if ("themeAdd" in t.dataset) {
    themes.push({ id: `theme-${Date.now().toString(36)}`, name: "" });   // id는 화면에 안 보이는 구분용
    renderCategories();
    return app.querySelector(`[data-theme-name="${themes.length - 1}"]`).focus();
  }
  if (t.dataset.themeDelete) { themes.splice(Number(t.dataset.themeDelete), 1); return renderCategories(); }
  if ("themeReset" in t.dataset) { themes = null; return renderCategories(); }
  if ("themeSave" in t.dataset) return saveThemes(t);
});

/* 상단 DM STUDIO 로고 → DM 목록. 저장 안 한 내용이 있으면 먼저 묻습니다 */
document.querySelector(".admin-header__home").addEventListener("click", event => {
  event.preventDefault();
  const leave = () => { order = null; hasUnsaved = null; location.hash === "#/" ? route() : go("#/"); };
  if (hasUnsaved?.()) confirmDialog({ title: "저장하지 않고 나갈까요?", message: "고친 내용이 사라져요.", ok: "나가기", onOk: leave });
  else leave();
});

app.addEventListener("input", event => {
  const index = event.target.dataset.themeName;
  if (index !== undefined) themes[Number(index)].name = event.target.value;
});

async function start() {
  try {
    [manifest, { templates }] = await Promise.all([fetchJSON(MANIFEST), loadCatalog({ includeHidden: true })]);
  } catch (error) {
    console.error(error);
    app.innerHTML = `<div class="empty"><strong>DM 목록을 불러오지 못했어요</strong><span>잠시 후 새로고침해 주세요.</span></div>`;
    return;
  }
  try {
    const notice = sessionStorage.getItem(NOTICE_KEY);
    if (notice) { sessionStorage.removeItem(NOTICE_KEY); toast(notice); }
  } catch { /* 알림 생략 */ }
  window.addEventListener("hashchange", route);
  route();
}

start();
