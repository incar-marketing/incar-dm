/**
 * admin/js/dialog.js — 되돌리기 어려운 작업 전에 한 번 더 묻는 창 (사용자 화면의 openModal 재사용)
 */
import { openModal, escapeHtml } from "../../assets/js/ui.js?v=20261127k";

/**
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.message
 * @param {string} options.ok      확인 버튼 글자 (예: "삭제하기")
 * @param {Function} options.onOk
 */
export function confirmDialog({ title, message, ok, onOk }) {
  openModal({
    labelledBy: "confirm-title",
    html: `
      <div class="confirm">
        <h2 id="confirm-title" class="modal__title">${escapeHtml(title)}</h2>
        <p class="modal__sub">${escapeHtml(message)}</p>
        <div class="confirm__buttons">
          <button type="button" class="btn" data-cancel>취소</button>
          <button type="button" class="btn btn--danger" data-ok>${escapeHtml(ok)}</button>
        </div>
      </div>`,
    onOpen(box, close) {
      box.querySelector("[data-cancel]").addEventListener("click", close);
      box.querySelector("[data-ok]").addEventListener("click", () => { close(); onOk(); });
      box.querySelector("[data-cancel]").focus();
    }
  });
}
