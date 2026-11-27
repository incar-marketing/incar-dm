/**
 * main.js — 시작점: 템플릿 목록을 불러오고, 주소(#)에 따라 화면을 바꿉니다.
 *   #/            DM 고르기
 *   #/dm/<폴더>    DM 만들기
 */
import { loadCatalog } from "./templates.js?v=20261127j";
import { store } from "./store.js?v=20261127j";
import { openProfileModal, toast } from "./ui.js?v=20261127j";
import { renderGallery, resetGallery } from "./pages/gallery.js?v=20261127j";
import { renderEditor } from "./pages/editor.js?v=20261127j";

const app = document.getElementById("app");
let catalog = null;

const goHome = (all = false) => { if (all) resetGallery(); location.hash = "#/"; };
const openTemplate = id => { location.hash = `#/dm/${encodeURIComponent(id)}`; };

function route() {
  const match = location.hash.match(/^#\/dm\/(.+)$/);
  const template = match && catalog.templates.find(t => t.id === decodeURIComponent(match[1]));
  document.body.classList.toggle("is-editor", !!template);
  if (match && !template) { toast("찾는 DM이 없어서 목록으로 왔어요"); return goHome(); }
  if (template) renderEditor(app, template, catalog, { goHome, openTemplate });
  else renderGallery(app, catalog, openTemplate);
  window.scrollTo(0, 0);
  if (!store.profile) openProfileModal({ first: true, onSaved: () => route() });
}

async function start() {
  // 로고(고객 DM)를 누르면 어느 화면에서든 처음 화면으로
  const onHomeClick = () => {
    resetGallery();
    if (location.hash === "#/" || location.hash === "") route();
    else goHome();
  };
  for (const id of ["home-button", "home-title"]) document.getElementById(id).addEventListener("click", onHomeClick);
  try {
    catalog = await loadCatalog();
  } catch (error) {
    console.error(error);
    app.innerHTML = `<div class="empty"><strong>DM 목록을 불러오지 못했어요</strong><span>잠시 후 새로고침해 주세요.</span></div>`;
    return;
  }
  window.addEventListener("hashchange", route);
  route();
}

start();
