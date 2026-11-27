/**
 * admin/js/api.js — 관리자 서버(worker/)에 저장을 요청합니다.
 *
 * 변경 묶음(changes) 모양 — 한 번 저장 = GitHub 커밋 하나. 중간에 실패하면 아무것도 바뀌지 않습니다.
 *   {
 *     message: "기록에 남길 설명",
 *     write:  [{ path: "templates/폴더/template.json", text: "..." } | { path: ".../bg.jpg", base64: "..." }],
 *     remove: ["templates/폴더/bg-old.jpg", "templates/지울폴더/"]   // "/"로 끝나면 폴더 통째로
 *   }
 * 로그인 확인과 파일 검사는 서버가 다시 합니다. 여기서 막는 것은 사용 편의를 위한 1차 확인입니다.
 */

// <base href="../"> 기준이라 '관리자 주소/api/save' 로 보내집니다. (주소를 코드에 적어 두지 않습니다)
const SAVE_URL = "api/save";

export const jsonFile = (path, data) => ({ path, text: `${JSON.stringify(data, null, 2)}\n` });

export async function saveChanges(changes) {
  let response;
  try {
    response = await fetch(SAVE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(changes)
    });
  } catch {
    throw new Error("서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요");
  }
  const result = await response.json().catch(() => null);
  // 일반 사이트 주소(GitHub Pages)나 PC에서 열면 저장 서버가 없어 JSON 답이 오지 않습니다
  if (!result) throw new Error("저장 서버에 연결되지 않았어요. 관리자 주소로 접속했는지 확인해 주세요");
  if (!response.ok) throw new Error(result.error || `저장하지 못했어요 (${response.status})`);
  return result;
}
