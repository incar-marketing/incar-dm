/**
 * store.js — 이 기기(브라우저)에만 저장하는 값
 * 서버로 보내는 값은 없습니다. 저장이 막힌 브라우저(사생활 보호 모드 등)에서도 화면은 그대로 동작합니다.
 */

const KEY = {
  profile: "dmstudio.profile",   // { agentName, agentPhone }
  recent: "dmstudio.recent",     // 최근 만든 템플릿 id 목록
  choice: "dmstudio.choice"      // 템플릿별 배경·로고 선택 { [templateId]: { background, logo } }
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장이 막혀 있어도 이번 방문 동안은 메모리 값으로 동작 */
  }
}

/** 메모리 상태: 고객 이름은 기기에 저장하지 않습니다(개인정보). */
const session = {
  customers: [""],
  previewIndex: 0
};

export const store = {
  get profile() {
    return read(KEY.profile, null);
  },
  setProfile(profile) {
    write(KEY.profile, profile);
  },

  get customers() {
    return session.customers;
  },
  setCustomers(list) {
    session.customers = list.length ? list : [""];
  },
  /** 빈칸을 뺀 고객 이름 */
  get customerNames() {
    return session.customers.map(name => name.trim()).filter(Boolean);
  },

  get previewIndex() {
    return session.previewIndex;
  },
  setPreviewIndex(index) {
    session.previewIndex = index;
  },

  get recent() {
    return read(KEY.recent, []);
  },
  addRecent(templateId) {
    const list = [templateId, ...this.recent.filter(id => id !== templateId)].slice(0, 8);
    write(KEY.recent, list);
  },

  choiceFor(template) {
    const saved = read(KEY.choice, {})[template.id] || {};
    const background = template.backgrounds.some(bg => bg.id === saved.background)
      ? saved.background
      : template.backgrounds[0].id;
    return { background, logo: "h" };   // 로고 고르기는 시안에서 빠져 기본(가로형)만 씁니다
  },
  setChoice(templateId, patch) {
    const all = read(KEY.choice, {});
    all[templateId] = { ...all[templateId], ...patch };
    write(KEY.choice, all);
  }
};
