/**
 * worker/worker.js — DM STUDIO 관리자 서버 (Cloudflare Workers)
 *
 * 하는 일
 *  1) 로그인 확인: Cloudflare Access 가 붙여 주는 로그인 증명(JWT)을 서버에서 직접 검증합니다.
 *  2) 관리자 화면 제공: GET 요청은 GitHub 저장소의 최신 파일(admin/ · assets/ · templates/)을 그대로 보여 줍니다.
 *     그래서 저장 직후에도 관리자 화면에는 바로 최신 내용이 보입니다. (사용자 사이트는 GitHub Pages 가 1~2분 뒤 반영)
 *  3) 저장: POST /api/save 로 받은 변경 묶음을 검사한 뒤 GitHub 커밋 하나로 저장합니다.
 *     커밋은 마지막 단계에서 한 번에 반영되므로, 중간에 실패하면 저장소는 전혀 바뀌지 않습니다.
 *
 * 환경변수 (Cloudflare 대시보드 → Worker → 설정 → 변수) — 코드에는 비밀 값을 적지 않습니다
 *  GITHUB_TOKEN        (비밀) GitHub 토큰. incar-dm 저장소 Contents 읽기/쓰기 권한만
 *  GITHUB_REPO         예) incar-marketing/incar-dm
 *  GITHUB_BRANCH       예) main
 *  ACCESS_TEAM_DOMAIN  예) https://incar-dm.cloudflareaccess.com  (Access 를 켤 때 나오는 팀 도메인, https:// 는 있어도 없어도 됨)
 *  ACCESS_AUD          Access 애플리케이션의 Audience(AUD) 태그
 *  ADMIN_EMAILS        (선택) 저장을 허용할 이메일, 쉼표로 구분. 비우면 Access 를 통과한 사람 모두 허용
 *
 * 개인정보: 요청 내용(파일·이메일)을 로그에 남기지 않고, 커밋 기록에도 관리자 이메일을 넣지 않습니다.
 */

const LIMITS = {
  bodyBytes: 20 * 1024 * 1024,   // 한 번 저장 요청 전체
  imageBytes: 5 * 1024 * 1024,   // 그림 한 장
  jsonBytes: 200 * 1024,         // 설정 파일 한 개
  files: 20                      // 한 번에 쓰거나 지울 파일 수
};
const SERVE_PREFIXES = ["admin/", "assets/", "templates/"];   // GET 으로 보여 줄 폴더 (worker/ 등은 제외)
const FOLDER = "[a-z0-9][a-z0-9-]*";                            // 관리자 화면 폴더 이름 규칙과 같음
const WRITABLE = new RegExp(`^templates/(manifest\\.json|${FOLDER}/[a-z0-9][a-z0-9._-]*\\.(json|jpe?g|png|webp))$`);
const REMOVABLE = new RegExp(`^templates/${FOLDER}/([a-z0-9][a-z0-9._-]*\\.(json|jpe?g|png|webp|pptx))?$`);   // "/"로 끝나면 폴더째
const IMAGE_SIGNATURES = [[0xff, 0xd8, 0xff], [0x89, 0x50, 0x4e, 0x47], [0x52, 0x49, 0x46, 0x46]];        // JPG, PNG, WEBP
const TYPES = {
  html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg",
  jpeg: "image/jpeg", webp: "image/webp", woff2: "font/woff2", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (status, data) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": TYPES.json, "Cache-Control": "no-store" }
});

/* ---------- 로그인 확인 (Cloudflare Access JWT) ---------- */
const base64UrlBytes = text => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
const base64UrlJson = text => JSON.parse(new TextDecoder().decode(base64UrlBytes(text)));

async function verifyLogin(request, env) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || token.split(".").length !== 3) throw new HttpError(401, "로그인이 필요해요");
  const [head, body, signature] = token.split(".");
  const team = env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, "").replace(/\/+$/, "");   // "https://..." 로 적어도 됨
  let header, claims;
  try { header = base64UrlJson(head); claims = base64UrlJson(body); } catch { throw new HttpError(401, "로그인 정보를 읽지 못했어요"); }

  const audiences = [].concat(claims.aud);
  const valid = claims.iss === `https://${team}` && audiences.includes(env.ACCESS_AUD) && claims.exp * 1000 > Date.now();
  if (!valid) throw new HttpError(401, "로그인이 만료됐거나 올바르지 않아요. 새로고침해 주세요");

  // Access 의 공개 키로 서명을 확인합니다 (키는 1시간 동안 캐시)
  const certs = await fetch(`https://${team}/cdn-cgi/access/certs`, { cf: { cacheTtl: 3600 } }).then(r => r.json());
  const jwk = (certs.keys || []).find(key => key.kid === header.kid);
  if (!jwk) throw new HttpError(401, "로그인 정보를 확인하지 못했어요");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signed = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, base64UrlBytes(signature), new TextEncoder().encode(`${head}.${body}`));
  if (!signed) throw new HttpError(401, "로그인 정보를 확인하지 못했어요");

  const allowed = (env.ADMIN_EMAILS || "").split(",").map(email => email.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(String(claims.email).toLowerCase())) throw new HttpError(403, "관리자로 등록된 이메일이 아니에요");
}

/* ---------- GitHub ---------- */
async function github(env, path, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: options.raw ? "application/vnd.github.raw" : "application/vnd.github+json",
      "User-Agent": "dm-studio-admin",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {})
    }
  });
  if (options.raw) return response;
  if (!response.ok) {
    console.error(`GitHub ${options.method || "GET"} ${path.split("?")[0]} → ${response.status}`);   // 내용은 남기지 않음
    if (response.status === 401 || response.status === 403) throw new HttpError(502, "GitHub 토큰이 만료됐거나 권한이 없어요. README의 '오류 해결'을 확인해 주세요");
    if (response.status === 409 || response.status === 422) throw new HttpError(409, "다른 저장과 겹쳤어요. 새로고침한 뒤 다시 저장해 주세요");
    throw new HttpError(502, "GitHub에 저장하지 못했어요. 잠시 후 다시 해 주세요");
  }
  return response.json();
}

/** 저장소의 최신 파일을 그대로 보여 줍니다 (관리자 화면 · 미리보기용) */
async function serveFile(url, env) {
  let path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (path === "" || path === "admin") return Response.redirect(`${url.origin}/admin/`, 302);
  if (path.endsWith("/")) path += "index.html";
  if (path.split("/").includes("..") || !SERVE_PREFIXES.some(prefix => path.startsWith(prefix))) return new Response("Not found", { status: 404 });
  const response = await github(env, `/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`, { raw: true });
  if (!response.ok) return new Response("Not found", { status: response.status === 404 ? 404 : 502 });
  return new Response(response.body, {
    headers: {
      "Content-Type": TYPES[path.split(".").pop().toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",            // 저장 직후 바로 최신 그림이 보이도록
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-Robots-Tag": "noindex"
    }
  });
}

/* ---------- 저장 요청 검사 ---------- */
function checkJsonFile(path, text) {
  if (typeof text !== "string" || text.length > LIMITS.jsonBytes) throw new HttpError(400, `${path} 내용이 너무 크거나 비어 있어요`);
  let data;
  try { data = JSON.parse(text); } catch { throw new HttpError(400, `${path} 형식이 올바르지 않아요`); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new HttpError(400, `${path} 형식이 올바르지 않아요`);
  if (path === "templates/manifest.json") {
    const ok = Array.isArray(data.themes) && data.themes.every(t => typeof t.id === "string" && typeof t.name === "string")
      && Array.isArray(data.templates) && data.templates.every(t => new RegExp(`^${FOLDER}$`).test(t.folder));
    if (!ok) throw new HttpError(400, "manifest.json 의 카테고리·목록 형식이 올바르지 않아요");
  } else if (path.endsWith("/template.json") && (typeof data.title !== "string" || !Array.isArray(data.texts))) {
    throw new HttpError(400, `${path} 에 제목이나 글자 자리가 없어요`);
  }
}

function checkImageFile(path, base64) {
  let bytes;
  try { bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0)); } catch { throw new HttpError(400, `${path} 그림을 읽지 못했어요`); }
  if (bytes.length > LIMITS.imageBytes) throw new HttpError(400, `${path} 그림이 너무 커요 (5MB 이하)`);
  if (!IMAGE_SIGNATURES.some(signature => signature.every((byte, i) => bytes[i] === byte))) throw new HttpError(400, `${path} 는 그림 파일이 아니에요`);
}

function checkChanges(changes) {
  if (!changes || typeof changes !== "object") throw new HttpError(400, "저장 요청 형식이 올바르지 않아요");
  const { message, write = [], remove = [] } = changes;
  if (typeof message !== "string" || !message.trim() || message.length > 200) throw new HttpError(400, "저장 설명이 없거나 너무 길어요");
  if (!Array.isArray(write) || !Array.isArray(remove) || !(write.length + remove.length) || write.length + remove.length > LIMITS.files) {
    throw new HttpError(400, "저장할 파일 수가 올바르지 않아요");
  }
  const seen = new Set();
  for (const file of write) {
    if (!file || !WRITABLE.test(file.path || "") || seen.has(file.path)) throw new HttpError(400, `저장할 수 없는 위치예요: ${file?.path}`);
    seen.add(file.path);
    if (file.path.endsWith(".json")) checkJsonFile(file.path, file.text);
    else checkImageFile(file.path, file.base64);
  }
  for (const path of remove) {
    if (typeof path !== "string" || !REMOVABLE.test(path) || [...seen].some(written => written.startsWith(path))) {
      throw new HttpError(400, `지울 수 없는 위치예요: ${path}`);
    }
  }
  return { message: message.trim(), write, remove };
}

/* ---------- 커밋 하나로 저장 ---------- */
async function commitChanges(env, { message, write, remove }) {
  const branch = encodeURIComponent(env.GITHUB_BRANCH);
  const head = (await github(env, `/git/ref/heads/${branch}`)).object.sha;
  const baseTree = (await github(env, `/git/commits/${head}`)).tree.sha;
  const entries = [];

  if (remove.length) {   // 지울 파일: 지금 저장소에 있는 것만 (폴더면 그 안의 파일 모두)
    const { tree, truncated } = await github(env, `/git/trees/${baseTree}?recursive=1`);
    if (truncated) throw new HttpError(500, "저장소 파일이 너무 많아 지울 파일을 확인하지 못했어요");
    for (const item of tree) {
      if (item.type === "blob" && remove.some(path => (path.endsWith("/") ? item.path.startsWith(path) : item.path === path))) {
        entries.push({ path: item.path, mode: "100644", type: "blob", sha: null });
      }
    }
  }
  for (const file of write) {
    const blob = await github(env, "/git/blobs", {
      method: "POST",
      body: JSON.stringify(file.text !== undefined ? { content: file.text, encoding: "utf-8" } : { content: file.base64, encoding: "base64" })
    });
    entries.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  if (!entries.length) throw new HttpError(400, "바뀐 파일이 없어요");

  const tree = await github(env, "/git/trees", { method: "POST", body: JSON.stringify({ base_tree: baseTree, tree: entries }) });
  const commit = await github(env, "/git/commits", { method: "POST", body: JSON.stringify({ message: `[관리자] ${message}`, tree: tree.sha, parents: [head] }) });
  // 여기서 처음으로 저장소가 바뀝니다. 그사이 다른 저장이 있었다면 force:false 라 거절됩니다(덮어쓰지 않음).
  await github(env, `/git/refs/heads/${branch}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
  return commit.sha;
}

async function handleSave(request, env) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) throw new HttpError(403, "다른 사이트에서 온 요청은 받지 않아요");
  if (!(request.headers.get("Content-Type") || "").startsWith("application/json")) throw new HttpError(415, "저장 요청 형식이 올바르지 않아요");
  if (Number(request.headers.get("Content-Length") || 0) > LIMITS.bodyBytes) throw new HttpError(413, "한 번에 올리는 파일이 너무 커요");
  const text = await request.text();
  if (text.length > LIMITS.bodyBytes) throw new HttpError(413, "한 번에 올리는 파일이 너무 커요");
  let changes;
  try { changes = JSON.parse(text); } catch { throw new HttpError(400, "저장 요청 형식이 올바르지 않아요"); }
  const commit = await commitChanges(env, checkChanges(changes));
  return json(200, { ok: true, commit });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      const missing = ["GITHUB_TOKEN", "GITHUB_REPO", "GITHUB_BRANCH", "ACCESS_TEAM_DOMAIN", "ACCESS_AUD"].filter(name => !env[name]);
      if (missing.length) throw new HttpError(500, `서버 설정이 빠졌어요: ${missing.join(", ")}`);
      await verifyLogin(request, env);
      if (url.pathname === "/api/save") {
        if (request.method !== "POST") throw new HttpError(405, "저장은 POST 로만 할 수 있어요");
        return await handleSave(request, env);
      }
      if (request.method !== "GET" && request.method !== "HEAD") throw new HttpError(405, "지원하지 않는 요청이에요");
      return await serveFile(url, env);
    } catch (error) {
      if (!(error instanceof HttpError)) console.error("unexpected", error?.name);   // 내용은 남기지 않음
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : "서버에서 문제가 생겼어요. 잠시 후 다시 해 주세요";
      return url.pathname.startsWith("/api/") ? json(status, { error: message }) : new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  }
};
