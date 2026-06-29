const page = document.body.dataset.page || "home";

const STORAGE_KEYS = {
  loggedIn: "birdoraLoggedIn",
  authUser: "birdora-auth-user",
  userPosts: "birdora-user-posts",
  comments: "birdora-post-comments",
  communityTab: "birdora-community-tab",
  deviceConnected: "birdora-device-connected",
};

const AUTH_PAGES = new Set(["home", "community"]);
const AUTH_API_BASE_URL = resolveAuthApiBaseUrl();
const AUTH_ROUTES = {
  register: "/api/auth/register",
  login: "/api/auth/login",
  logout: "/api/auth/logout",
  me: "/api/auth/me",
  status: "/api/auth/status",
};
const OSEA_LABELS_PATH = "./assets/osea/bird_info.json";
const BIRD_PROFILES_PATH = "./assets/atlas/bird-profiles.json";
const COMMON_BIRD_CANDIDATES_PATH = "./assets/atlas/common-bird-candidates.json";
const OSEA_TOP_K = 5;
const OSEA_CONFIDENCE_THRESHOLD = 0.05;
const ATLAS_INITIAL_LIMIT = 12;
const ATLAS_SEARCH_LIMIT = 24;
const ATLAS_TABLET_INITIAL_LIMIT = 8;
const ATLAS_MOBILE_INITIAL_LIMIT = 4;
const ATLAS_MOBILE_SEARCH_LIMIT = 12;
const POST_TITLE_MAX_LENGTH = 80;
const POST_BODY_MAX_LENGTH = 600;
const COMMENT_MAX_LENGTH = 180;

const fallbackBirdProfiles = [
  {
    oseaIndex: 3334,
    oseaName: "普通翠鸟",
    aliases: ["普通翠鸟"],
    name: "翠鸟",
    latin: "Alcedo atthis",
    habitat: "water",
    place: "河流、湖泊、湿地",
    feature: "蓝绿色背部，橙色腹部，常贴近水面快速飞行。",
    food: "小鱼、虾类、水生昆虫",
    image:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Alcedo_atthis_-England-8_%28cropped%29.jpg/330px-Alcedo_atthis_-England-8_%28cropped%29.jpg",
    source: "https://en.wikipedia.org/wiki/Common_kingfisher",
    clue: "常停在临水枝条上，发现猎物后俯冲入水。",
  },
  {
    oseaIndex: 861,
    name: "白鹭",
    latin: "Egretta garzetta",
    habitat: "water",
    place: "浅滩、稻田、湿地",
    feature: "通体白色，颈部修长，觅食时步伐缓慢。",
    food: "鱼虾、蛙类、昆虫",
    image:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/Little_egret_%28Egretta_garzetta%29_Photograph_by_Shantanu_Kuveskar.jpg/330px-Little_egret_%28Egretta_garzetta%29_Photograph_by_Shantanu_Kuveskar.jpg",
    source: "https://en.wikipedia.org/wiki/Little_egret",
    clue: "黑嘴黑腿，脚趾偏黄，常在浅水边缓慢觅食。",
  },
  {
    oseaIndex: 7201,
    name: "白头鹎",
    latin: "Pycnonotus sinensis",
    habitat: "city",
    place: "城市绿地、庭院、公园",
    feature: "头顶白斑明显，叫声清亮，是城市常见鸟。",
    food: "果实、花蜜、昆虫",
    image:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/6/66/Light-vented_Bulbul2.jpg/330px-Light-vented_Bulbul2.jpg",
    source: "https://en.wikipedia.org/wiki/Light-vented_bulbul",
    clue: "头顶黑、后颈有白斑，城市绿化带很常见。",
  },
  {
    oseaIndex: 1892,
    name: "珠颈斑鸠",
    latin: "Spilopelia chinensis",
    habitat: "city",
    place: "街区、公园、农田",
    feature: "颈侧有黑底白点斑块，常在地面慢步觅食。",
    food: "种子、谷粒、嫩芽",
    image:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Spotted_dove_%28Spilopelia_chinensis_suratensis%29.jpg/330px-Spotted_dove_%28Spilopelia_chinensis_suratensis%29.jpg",
    source: "https://en.wikipedia.org/wiki/Spotted_dove",
    clue: "颈侧黑底白点像项链，起飞时有明显振翅声。",
  },
  {
    oseaIndex: 6798,
    name: "灰喜鹊",
    latin: "Cyanopica cyanus",
    habitat: "forest",
    place: "林缘、灌丛、校园",
    feature: "尾羽较长，翅尾带蓝色，常成小群活动。",
    food: "昆虫、果实、种子",
    image:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/2011_Blauelster_in_Shanghai.jpg/330px-2011_Blauelster_in_Shanghai.jpg",
    source: "https://en.wikipedia.org/wiki/Azure-winged_magpie",
    clue: "黑色头顶、蓝色翅尾，常成群穿梭在林缘。",
  },
  {
    oseaIndex: 6803,
    name: "红嘴蓝鹊",
    latin: "Urocissa erythroryncha",
    habitat: "forest",
    place: "山地林区、林缘",
    feature: "红色嘴和脚，蓝色长尾醒目，叫声响亮。",
    food: "昆虫、果实、小型动物",
    image:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/Urocissa_erythrorhyncha.jpg/330px-Urocissa_erythrorhyncha.jpg",
    source: "https://en.wikipedia.org/wiki/Red-billed_blue_magpie",
    clue: "红色嘴脚、长尾蓝羽非常醒目。",
  },
  {
    oseaIndex: 1388,
    name: "黑水鸡",
    latin: "Gallinula chloropus",
    habitat: "water",
    place: "芦苇荡、池塘、河汊",
    feature: "额甲红色，身体深色，游动时尾部常上翘。",
    food: "水草、昆虫、软体动物",
    image:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ee/Common_moorhen_%28Gallinula_chloropus%29_France.jpg/330px-Common_moorhen_%28Gallinula_chloropus%29_France.jpg",
    source: "https://en.wikipedia.org/wiki/Common_moorhen",
    clue: "红额甲和红黄相间的嘴明显。",
  },
  {
    oseaIndex: 6452,
    name: "棕背伯劳",
    latin: "Lanius schach",
    habitat: "forest",
    place: "灌丛、农田边缘、开阔林地",
    feature: "黑色眼罩明显，常站在枝头观察猎物。",
    food: "昆虫、小型蜥蜴",
    image:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/8/83/Long-tailed_Shrilke_0A2A3080.jpg/330px-Long-tailed_Shrilke_0A2A3080.jpg",
    source: "https://en.wikipedia.org/wiki/Long-tailed_shrike",
    clue: "黑色眼罩、棕背和长尾非常明显。",
  },
  {
    oseaIndex: 7381,
    name: "家燕",
    latin: "Hirundo rustica",
    habitat: "city",
    place: "村镇、农田、湿地边缘",
    feature: "上体蓝黑色，喉部红褐，尾羽分叉明显，飞行敏捷。",
    food: "飞虫、蜻蜓、小型昆虫",
    image:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7d/Rauchschwalbe_Hirundo_rustica.jpg/330px-Rauchschwalbe_Hirundo_rustica.jpg",
    source: "https://en.wikipedia.org/wiki/Barn_swallow",
    clue: "低空快速穿梭，尾巴像剪刀一样分叉。",
  },
  {
    oseaIndex: 9380,
    name: "麻雀",
    latin: "Passer montanus",
    habitat: "city",
    place: "城市街区、村庄、农田",
    feature: "体型小，褐色背部带纵纹，脸颊有黑斑。",
    food: "种子、谷粒、昆虫",
    image:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Tree_Sparrow_August_2007_Osaka_Japan.jpg/330px-Tree_Sparrow_August_2007_Osaka_Japan.jpg",
    source: "https://en.wikipedia.org/wiki/Eurasian_tree_sparrow",
    clue: "常成群在地面啄食，头顶栗褐色。",
  },
];

let birds = fallbackBirdProfiles.map(normalizeBirdProfile);

const recommendedPosts = [
  {
    id: "post-egret-morning",
    title: "今天在湿地看到白鹭整理羽毛",
    body: "距离很远拍下来的，识别后才发现它正在浅滩边觅食。站了很久，动作特别优雅。",
    bird: "白鹭",
    time: "09:42",
    author: "西溪观察员",
    source: "recommended",
  },
  {
    id: "post-bulbul-park",
    title: "公园里的白头鹎",
    body: "它一直在香樟树上叫，眼镜同步的位置很准，连续记录到了三次停枝和一次低飞。",
    bird: "白头鹎",
    time: "昨天",
    author: "晨光巡园者",
    source: "recommended",
  },
  {
    id: "post-kingfisher-river",
    title: "河边等到一只贴水飞过的翠鸟",
    body: "等了二十分钟才拍到，速度非常快，几乎是一道蓝绿色的闪光，最后停在一根枯枝上。",
    bird: "翠鸟",
    time: "昨天",
    author: "溪流守望者",
    source: "recommended",
  },
  {
    id: "post-swallow-rain",
    title: "雨前低空飞行的家燕群",
    body: "傍晚天气闷热，家燕在很低的位置来回穿梭，抓拍时能明显看到尾羽的分叉轮廓。",
    bird: "家燕",
    time: "2 天前",
    author: "云边观鸟",
    source: "recommended",
  },
  {
    id: "post-moorhen-lake",
    title: "荷叶边的黑水鸡",
    body: "原本以为只是水面阴影，仔细看才发现是黑水鸡在荷叶缝里慢慢穿过，嘴和额甲特别醒目。",
    bird: "黑水鸡",
    time: "3 天前",
    author: "湖岸小队",
    source: "recommended",
  },
];

const birdGrid = document.querySelector("#birdGrid");
const birdSearch = document.querySelector("#birdSearch");
const atlasSummary = document.querySelector("#atlasSummary");
const atlasDetail = document.querySelector("#atlasDetail");
const upload = document.querySelector("#birdUpload");
const preview = document.querySelector("#previewImage");
const uploadZone = document.querySelector(".upload-zone");
const confidenceText = document.querySelector("#confidenceText");
const resultName = document.querySelector("#resultName");
const resultMeta = document.querySelector("#resultMeta");
const resultFeature = document.querySelector("#resultFeature");
const modelDetail = document.querySelector("#modelDetail");
const confidenceRing = document.querySelector(".confidence-ring");
const candidateList = document.querySelector("#candidateList");
const feed = document.querySelector("#feed");
const communityFeed = document.querySelector("#communityFeed");
const postForm = document.querySelector("#postForm");
const postTitle = document.querySelector("#postTitle");
const postBody = document.querySelector("#postBody");
const useDetected = document.querySelector("#useDetected");
const communityTabs = document.querySelectorAll("[data-community-tab]");
const logoutButtons = document.querySelectorAll("[data-logout]");
const authForms = document.querySelectorAll("[data-auth-form]");
const authSwitchButtons = document.querySelectorAll("[data-auth-switch]");
const authModeFields = document.querySelectorAll("[data-auth-visible]");
const authModeEyebrow = document.querySelector("#authModeEyebrow");
const authModeTitle = document.querySelector("#authModeTitle");
const authModeCopy = document.querySelector("#authModeCopy");
const authSubmitBtn = document.querySelector("#authSubmitBtn");
const authSwitchLead = document.querySelector("#authSwitchLead");
const userNameBadges = document.querySelectorAll("[data-user-name]");
const deviceConnectionTitle = document.querySelector("#deviceConnectionTitle");
const deviceConnectBtn = document.querySelector("#deviceConnectBtn");
const deviceBatteryValue = document.querySelector("#deviceBatteryValue");
const deviceStorageValue = document.querySelector("#deviceStorageValue");
const deviceFirmwareValue = document.querySelector("#deviceFirmwareValue");
const deviceSyncStatus = document.querySelector("#deviceSyncStatus");

const expandedComments = new Set();

let detectedBird = birds[0];
let classifierPromise;
let birdInfoPromise;
let birdProfilesPromise;
let commonBirdCandidatesPromise;
let atlasEntriesPromise;
let atlasSearchTimer = null;
let selectedAtlasIndex = null;
let birdProfilesSource = "fallback";
let birdProfilesLoadError = "";
let userPosts = [];
let commentsByPostId = {};
let activeCommunityTab = "recommended";
let currentUser = null;
let homeCommunityRevealPlayed = false;
let homeCommunityRevealObserver = null;
let deviceConnectionTimer = null;
let localAtlasMatches = new Map();
let communityTabsBound = false;
let recognitionRunId = 0;
let lastRecognitionStatus = "idle";

rebuildLocalAtlasMatches();

function normalizeBirdProfile(profile) {
  const name = String(profile?.name || profile?.cn || "").trim();
  const latin = String(profile?.latin || "").trim();
  const source = String(profile?.source || "").trim();

  return {
    oseaIndex: Number.isInteger(profile?.oseaIndex) ? profile.oseaIndex : null,
    oseaName: String(profile?.oseaName || "").trim(),
    aliases: Array.isArray(profile?.aliases)
      ? profile.aliases.map((alias) => String(alias).trim()).filter(Boolean)
      : [],
    name,
    latin,
    habitat: String(profile?.habitat || "unknown").trim(),
    place: String(profile?.place || "分布资料待补充").trim(),
    feature: String(profile?.feature || "形态识别资料待补充。").trim(),
    food: String(profile?.food || "待补充").trim(),
    image: String(profile?.image || "").trim(),
    source,
    imageCredit: String(profile?.imageCredit || "").trim(),
    license: String(profile?.license || "").trim(),
    clue: String(profile?.clue || "建议结合拍摄地点、体型、羽色和行为继续判断。").trim(),
  };
}

function rebuildLocalAtlasMatches(profiles = birds) {
  localAtlasMatches = new Map(
    profiles
      .filter((profile) => Number.isInteger(profile.oseaIndex) && profile.name)
      .map((profile) => [profile.oseaIndex, profile.name])
  );
}

function getBirdProfiles() {
  if (!birdProfilesPromise) {
    birdProfilesPromise = fetch(BIRD_PROFILES_PATH)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`富图鉴资料加载失败：${response.status}`);
        }
        return response.json();
      })
      .then((profiles) => {
        if (!Array.isArray(profiles)) {
          throw new Error("富图鉴资料格式不正确。");
        }

        birds = profiles.map(normalizeBirdProfile).filter((profile) => profile.name && profile.latin);
        if (!birds.length) {
          throw new Error("富图鉴资料为空。");
        }

        detectedBird = birds[0];
        atlasEntriesPromise = null;
        rebuildLocalAtlasMatches();
        birdProfilesSource = "external";
        birdProfilesLoadError = "";
        return birds;
      })
      .catch((error) => {
        birds = fallbackBirdProfiles.map(normalizeBirdProfile);
        detectedBird = birds[0];
        atlasEntriesPromise = null;
        rebuildLocalAtlasMatches();
        birdProfilesSource = "fallback";
        birdProfilesLoadError = error.message || "富图鉴资料加载失败。";
        console.warn(birdProfilesLoadError);
        return birds;
      });
  }

  return birdProfilesPromise;
}

function getCommonBirdCandidates() {
  if (!commonBirdCandidatesPromise) {
    commonBirdCandidatesPromise = fetch(COMMON_BIRD_CANDIDATES_PATH)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`候选清单加载失败：${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        if (!data || !Array.isArray(data.candidates)) {
          throw new Error("候选清单格式不正确。");
        }
        return data.candidates;
      })
      .catch((error) => {
        console.warn(error.message || "候选清单加载失败。");
        return [];
      });
  }

  return commonBirdCandidatesPromise;
}

function safeParseStorage(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function saveStorage(key, value) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function resolveAuthApiBaseUrl() {
  if (window.BIRDORA_API_BASE_URL) {
    return String(window.BIRDORA_API_BASE_URL).replace(/\/$/, "");
  }

  const { hostname, port, protocol } = window.location;
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";

  if (protocol === "file:") {
    return "http://localhost:4000";
  }

  if (isLocalHost && port !== "4000") {
    return `${protocol}//${hostname}:4000`;
  }

  return "";
}

function normalizeAuthUser(user) {
  if (!user || typeof user.email !== "string" || !user.email.trim()) {
    return null;
  }

  const email = user.email.trim().toLowerCase();
  const nickname =
    typeof user.nickname === "string" && user.nickname.trim()
      ? user.nickname.trim()
      : email.split("@")[0];

  return {
    id: user.id,
    email,
    nickname,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function rememberAuthUser(user) {
  const normalizedUser = normalizeAuthUser(user);
  if (!normalizedUser) return null;

  window.localStorage.setItem(STORAGE_KEYS.loggedIn, "true");
  saveStorage(STORAGE_KEYS.authUser, normalizedUser);
  currentUser = normalizedUser;
  renderUserChrome();
  return normalizedUser;
}

function clearAuthState() {
  window.localStorage.removeItem(STORAGE_KEYS.loggedIn);
  window.localStorage.removeItem(STORAGE_KEYS.authUser);
  currentUser = null;
  renderUserChrome();
}

function renderUserChrome() {
  const displayName = currentUser?.nickname || currentUser?.email?.split("@")[0] || "";

  userNameBadges.forEach((badge) => {
    if (!displayName) {
      badge.textContent = "";
      badge.hidden = true;
      return;
    }

    badge.textContent = displayName;
    badge.hidden = false;
  });
}

function translateAuthMessage(message, fallback = "认证请求失败，请稍后重试。") {
  const messages = {
    "email and password are required": "请先填写邮箱和密码。",
    "email format is invalid": "邮箱格式不正确，请检查后重试。",
    "password must be at least 6 characters": "密码至少需要 6 位。",
    "email is already registered": "这个邮箱已经注册过了，请直接登录。",
    "email or password is incorrect": "邮箱或密码不正确，请检查后重试。",
    Unauthorized: "登录状态已失效，请重新登录。",
  };

  return messages[message] || message || fallback;
}

async function authRequest(path, options = {}) {
  const { method = "GET", body } = options;
  const headers = {
    Accept: "application/json",
  };

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  let response;
  try {
    response = await fetch(`${AUTH_API_BASE_URL}${path}`, {
      method,
      credentials: "include",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("无法连接后端认证服务，请确认后端已经启动。");
  }

  const rawBody = await response.text();
  let data = null;
  try {
    data = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    data = rawBody;
  }

  if (!response.ok) {
    const message = data && typeof data === "object" ? data.message : null;
    throw new Error(translateAuthMessage(message));
  }

  return data;
}

async function fetchAuthStatus() {
  try {
    return await authRequest(AUTH_ROUTES.status);
  } catch {
    return {
      authenticated: false,
      user: null,
    };
  }
}

function getAuthUser() {
  return safeParseStorage(STORAGE_KEYS.authUser, null);
}

function isLoggedIn() {
  return window.localStorage.getItem(STORAGE_KEYS.loggedIn) === "true";
}

function getValidatedAuthUser() {
  if (!isLoggedIn()) {
    return null;
  }

  return normalizeAuthUser(getAuthUser());
}

async function requireAuth() {
  if (!AUTH_PAGES.has(page)) {
    return true;
  }

  const status = await fetchAuthStatus();
  if (!status.authenticated || !status.user) {
    clearAuthState();
    window.location.replace("./login.html");
    return false;
  }

  rememberAuthUser(status.user);
  return true;
}

function createPostId() {
  return `post-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char];
  });
}

function truncateText(text, maxLength = 96) {
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function normalizeUserText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function loadUserPosts() {
  const allPosts = safeParseStorage(STORAGE_KEYS.userPosts, []);
  userPosts = currentUser ? allPosts.filter((post) => post.ownerEmail === currentUser.email) : [];
}

function saveUserPosts() {
  const allPosts = safeParseStorage(STORAGE_KEYS.userPosts, []);
  const otherPosts = currentUser ? allPosts.filter((post) => post.ownerEmail !== currentUser.email) : allPosts;
  saveStorage(STORAGE_KEYS.userPosts, [...userPosts, ...otherPosts]);
}

function loadComments() {
  commentsByPostId = safeParseStorage(STORAGE_KEYS.comments, {});
}

function saveComments() {
  saveStorage(STORAGE_KEYS.comments, commentsByPostId);
}

function getAllCommunityPosts() {
  return [...userPosts, ...recommendedPosts];
}

function getComments(postId) {
  const comments = commentsByPostId[postId];
  return Array.isArray(comments) ? comments : [];
}

function formatComments(postId) {
  const comments = getComments(postId);
  if (!comments.length) {
    return `<p class="comment-empty">还没有评论，来写一句吧。</p>`;
  }

  return comments
    .map(
      (comment) => `
        <li class="comment-bubble">
          <p>${escapeHtml(comment.text)}</p>
          <span>${escapeHtml(comment.time)}</span>
        </li>
      `
    )
    .join("");
}

function buildFeedCard(post, options = {}) {
  const previewMode = options.preview === true;
  const body = previewMode ? truncateText(post.body, 88) : post.body;
  const authorText = post.author || post.bird;
  const previewClass = previewMode ? " feed-card-preview" : "";

  return `
    <article class="feed-card${previewClass}" data-post-id="${post.id}">
      <div class="feed-meta"><span>${escapeHtml(authorText)}</span><span>${escapeHtml(post.time)}</span></div>
      <h3>${escapeHtml(post.title)}</h3>
      <p class="feed-body">${escapeHtml(body)}</p>
      <div class="comment-box ${expandedComments.has(post.id) ? "is-open" : ""}">
        <div class="comment-toolbar">
          <button class="comment-toggle" type="button" data-comment-toggle="${post.id}">评论</button>
          <span class="comment-count">评论 ${getComments(post.id).length}</span>
        </div>
        <div class="comment-panel">
          <div class="comment-form">
            <input
              class="comment-input"
              type="text"
              placeholder="写下你的观察或想法..."
              data-comment-input="${post.id}"
            />
            <button class="comment-send" type="button" data-comment-submit="${post.id}">发送</button>
          </div>
          <ul class="comment-list">${formatComments(post.id)}</ul>
        </div>
      </div>
    </article>
  `;
}

function renderHomeFeed() {
  if (!feed) return;
  const previewPosts = getAllCommunityPosts().slice(0, 3);
  feed.innerHTML = previewPosts.map((post) => buildFeedCard(post, { preview: true })).join("");
  syncHomeCommunityReveal();
}

function renderCommunityFeed() {
  if (!communityFeed) return;

  const posts = activeCommunityTab === "mine" ? userPosts : recommendedPosts;
  if (!posts.length) {
    communityFeed.innerHTML = `
      <article class="feed-card empty-feed-card">
        <h3>${activeCommunityTab === "mine" ? "还没有你发布的帖子" : "暂无推荐帖子"}</h3>
        <p>${activeCommunityTab === "mine" ? "先回到首页发布一条观鸟笔记吧。" : "稍后再来看看新的观鸟分享。"}</p>
      </article>
    `;
    return;
  }

  communityFeed.innerHTML = posts.map((post) => buildFeedCard(post)).join("");
}

function renderCurrentFeed() {
  if (page === "community") {
    renderCommunityFeed();
  } else {
    renderHomeFeed();
  }
}

function toggleComments(postId) {
  if (expandedComments.has(postId)) {
    expandedComments.delete(postId);
  } else {
    expandedComments.add(postId);
  }
  renderCurrentFeed();
}

function submitComment(postId) {
  const currentFeed = page === "community" ? communityFeed : feed;
  const field = currentFeed?.querySelector(`[data-comment-input="${postId}"]`);
  if (!field) return;

  const text = normalizeUserText(field.value, COMMENT_MAX_LENGTH);
  if (!text) {
    field.focus();
    return;
  }

  const comment = {
    text,
    time: new Date().toLocaleString("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };

  commentsByPostId[postId] = [...getComments(postId), comment];
  saveComments();
  expandedComments.add(postId);
  renderCurrentFeed();
}

function bindCommentFeed(root) {
  if (!root) return;

  root.addEventListener("click", (event) => {
    const toggleButton = event.target.closest("[data-comment-toggle]");
    if (toggleButton) {
      toggleComments(toggleButton.dataset.commentToggle);
      return;
    }

    const submitButton = event.target.closest("[data-comment-submit]");
    if (submitButton) {
      submitComment(submitButton.dataset.commentSubmit);
    }
  });

  root.addEventListener("keydown", (event) => {
    const input = event.target.closest("[data-comment-input]");
    if (!input || event.key !== "Enter") return;
    event.preventDefault();
    submitComment(input.dataset.commentInput);
  });
}

function syncCommunityTabs() {
  if (!communityTabs.length) return;

  activeCommunityTab = window.localStorage.getItem(STORAGE_KEYS.communityTab) || "recommended";

  communityTabs.forEach((tab) => {
    const active = tab.dataset.communityTab === activeCommunityTab;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });
}

function initCommunityTabs() {
  if (!communityTabs.length) return;

  syncCommunityTabs();

  if (communityTabsBound) return;
  communityTabsBound = true;

  communityTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activeCommunityTab = tab.dataset.communityTab;
      window.localStorage.setItem(STORAGE_KEYS.communityTab, activeCommunityTab);
      syncCommunityTabs();
      renderCommunityFeed();
    });
  });
}

function initAuthForms() {
  const form = authForms[0];
  if (!form) return;

  const message = form.querySelector("[data-auth-message]");
  const emailField = form.querySelector('[name="email"]');
  const passwordField = form.querySelector('[name="password"]');
  const nicknameField = form.querySelector('[name="nickname"]');
  const agreeField = form.querySelector('[name="agree"]');
  if (!message || !emailField || !passwordField || !nicknameField || !agreeField) return;

  const modeConfig = {
    login: {
      eyebrow: "登录",
      title: "继续你的观鸟记录",
      copy: "登录 Birdora，继续保存你的观鸟笔记、评论和识别记录。",
      submit: "登录",
      switchLead: "还没有账号？",
      switchAction: "去注册",
      nextMode: "register",
    },
    register: {
      eyebrow: "注册",
      title: "创建你的 Birdora 账号",
      copy: "创建 Birdora 账号，继续同步你的观鸟笔记、评论和识别记录。",
      submit: "注册并进入",
      switchLead: "已经有账号？",
      switchAction: "去登录",
      nextMode: "login",
    },
  };

  const setMessage = (text = "") => {
    message.textContent = text;
  };

  const setSubmitting = (submitting) => {
    if (authSubmitBtn) {
      authSubmitBtn.disabled = submitting;
      authSubmitBtn.textContent = submitting ? "请稍候..." : modeConfig[form.dataset.authMode || "login"].submit;
    }

    authSwitchButtons.forEach((button) => {
      button.disabled = submitting;
    });
  };

  const setAuthMode = (mode) => {
    const config = modeConfig[mode] || modeConfig.login;
    form.dataset.authMode = mode;

    if (authModeEyebrow) authModeEyebrow.textContent = config.eyebrow;
    if (authModeTitle) authModeTitle.textContent = config.title;
    if (authModeCopy) authModeCopy.textContent = config.copy;
    if (authSubmitBtn) authSubmitBtn.textContent = config.submit;
    if (authSwitchLead) authSwitchLead.textContent = config.switchLead;

    authSwitchButtons.forEach((button) => {
      button.dataset.authSwitch = config.nextMode;
      button.textContent = config.switchAction;
      button.classList.remove("auth-hidden");
      button.disabled = false;
    });

    authModeFields.forEach((field) => {
      const visible = field.dataset.authVisible === mode;
      field.classList.toggle("auth-hidden", !visible);
      field.setAttribute("aria-hidden", String(!visible));
      field.querySelectorAll("input").forEach((input) => {
        input.disabled = !visible;
      });
    });

    passwordField.autocomplete = mode === "register" ? "new-password" : "current-password";
    setMessage("");
  };

  authSwitchButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setAuthMode(button.dataset.authSwitch || "login");
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setMessage("");

    const mode = form.dataset.authMode || "login";
    const email = emailField.value.trim().toLowerCase();
    const password = passwordField.value.trim();

    if (!email || !password) {
      setMessage("请先填写邮箱和密码。");
      return;
    }

    if (mode === "register") {
      const nickname = nicknameField.value.trim();
      const agreed = agreeField.checked;

      if (!nickname) {
        setMessage("请先填写昵称。");
        nicknameField.focus();
        return;
      }

      if (!agreed) {
        setMessage("请先勾选同意《用户协议》和《隐私政策》。");
        return;
      }

      setSubmitting(true);
      try {
        const result = await authRequest(AUTH_ROUTES.register, {
          method: "POST",
          body: { email, password, nickname },
        });

        rememberAuthUser(result.user);
        window.location.replace("./index.html");
      } catch (error) {
        setMessage(error.message || "注册失败，请稍后重试。");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    setSubmitting(true);
    try {
      const result = await authRequest(AUTH_ROUTES.login, {
        method: "POST",
        body: { email, password },
      });

      rememberAuthUser(result.user);
      window.location.replace("./index.html");
    } catch (error) {
      setMessage(error.message || "登录失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  });

  setAuthMode(form.dataset.authMode || "login");
}

async function logout() {
  try {
    await authRequest(AUTH_ROUTES.logout, { method: "POST" });
  } catch {
    // Local session cleanup should still happen if the server is unreachable.
  }

  clearAuthState();
  window.location.replace("./login.html");
}

function initLogoutButtons() {
  logoutButtons.forEach((button) => {
    button.addEventListener("click", logout);
  });
}

function getClassifier() {
  if (!classifierPromise) {
    if (!window.ort) {
      classifierPromise = Promise.reject(
        new Error("ONNX Runtime 没有加载完成，请确认 assets/vendor/ort.min.js 存在。")
      );
    } else {
      window.ort.env.wasm.numThreads = 1;
      window.ort.env.wasm.wasmPaths = new URL("./assets/vendor/", window.location.href).href;
      classifierPromise = window.ort.InferenceSession.create("./assets/osea/bird_model.onnx", {
        executionProviders: ["wasm"],
      });
    }
  }
  return classifierPromise;
}

function getBirdInfo() {
  if (!birdInfoPromise) {
    birdInfoPromise = fetch(OSEA_LABELS_PATH)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`鸟类标签库加载失败：${response.status}`);
        }
        return response.json();
      })
      .then((labels) => {
        if (!Array.isArray(labels)) {
          throw new Error("鸟类标签库格式不正确。");
        }
        return labels;
      });
  }

  return birdInfoPromise;
}

function updateModelReadiness() {
  if (!resultMeta || !modelDetail) return;

  window.setTimeout(() => {
    if (window.ort) {
      resultMeta.textContent = "OSEA 模型运行器已就绪，首次识别会加载模型和标签库";
      modelDetail.textContent =
        "已接入 sun-jiao/osea_mobile 的 bird_model.onnx，识别时从全量标签库返回 Top 5 候选。";
    } else {
      resultMeta.textContent = "AI 模型准备中，如果一直不变请检查资源文件";
      modelDetail.textContent = "ONNX Runtime 或模型资源未加载完成，上传时会自动重试。";
    }
  }, 500);
}

function imageToOseaTensor(imageElement) {
  const size = 224;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(imageElement, 0, 0, size, size);
  const pixels = ctx.getImageData(0, 0, size, size).data;
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  const channelSize = size * size;
  const input = new Float32Array(3 * channelSize);

  for (let i = 0, p = 0; i < pixels.length; i += 4, p += 1) {
    input[p] = (pixels[i] / 255 - mean[0]) / std[0];
    input[channelSize + p] = (pixels[i + 1] / 255 - mean[1]) / std[1];
    input[channelSize * 2 + p] = (pixels[i + 2] / 255 - mean[2]) / std[2];
  }

  return new window.ort.Tensor("float32", input, [1, 3, size, size]);
}

function normalizeOseaLabel(entry, index) {
  const [cn, en, latin] = Array.isArray(entry) ? entry : [];

  return {
    index,
    cn: cn || `OSEA 标签 ${index + 1}`,
    en: en || "",
    latin: latin || "",
  };
}

function insertTopCandidate(candidates, candidate, limit) {
  const insertAt = candidates.findIndex((item) => candidate.raw > item.raw);

  if (insertAt === -1) {
    candidates.push(candidate);
  } else {
    candidates.splice(insertAt, 0, candidate);
  }

  if (candidates.length > limit) {
    candidates.pop();
  }
}

function findAtlasBirdForCandidate(candidate) {
  const mappedName = localAtlasMatches.get(candidate.index);
  if (mappedName) {
    return birds.find((bird) => bird.name === mappedName) || null;
  }

  return (
    birds.find((bird) => {
      return bird.name === candidate.cn || bird.latin === candidate.latin;
    }) || null
  );
}

function topOseaCandidates(logits, birdInfo, limit = OSEA_TOP_K) {
  const length = Math.min(logits.length, birdInfo.length);
  let maxLogit = -Infinity;

  for (let index = 0; index < length; index += 1) {
    const raw = Number(logits[index]);
    if (Number.isFinite(raw) && raw > maxLogit) {
      maxLogit = raw;
    }
  }

  if (!Number.isFinite(maxLogit)) {
    return [];
  }

  let sumExp = 0;
  const candidates = [];

  for (let index = 0; index < length; index += 1) {
    const raw = Number(logits[index]);
    if (!Number.isFinite(raw)) continue;

    const exp = Math.exp(raw - maxLogit);
    sumExp += exp;
    insertTopCandidate(candidates, {
      ...normalizeOseaLabel(birdInfo[index], index),
      raw,
      exp,
    }, limit);
  }

  return candidates.map((candidate) => {
    const probability = sumExp > 0 ? candidate.exp / sumExp : 0;
    return {
      ...candidate,
      probability,
      atlasBird: findAtlasBirdForCandidate(candidate),
    };
  });
}

async function classifyImageElement(imageElement) {
  const [classifier, birdInfo] = await Promise.all([getClassifier(), getBirdInfo()]);
  const tensor = imageToOseaTensor(imageElement);
  const feeds = { [classifier.inputNames[0]]: tensor };
  const outputMap = await classifier.run(feeds);
  const output = outputMap[classifier.outputNames[0]];
  const candidates = topOseaCandidates(output.data, birdInfo);

  return {
    candidates,
    labelCount: birdInfo.length,
    top: candidates[0] || null,
    isConfident: Boolean(candidates[0] && candidates[0].probability >= OSEA_CONFIDENCE_THRESHOLD),
  };
}

function buildSearchText(parts) {
  return parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function createRichAtlasEntry(bird, index = null, label = null) {
  const cn = label?.cn || bird.name;
  const en = label?.en || "";
  const latin = label?.latin || bird.latin;

  return {
    index,
    name: bird.name,
    cn,
    en,
    latin,
    habitat: bird.habitat,
    place: bird.place,
    feature: bird.feature,
    food: bird.food,
    clue: bird.clue,
    image: bird.image,
    source: bird.source,
    imageCredit: bird.imageCredit,
    license: bird.license,
    detailLevel: "rich",
    status: "图文已补充",
    searchText: buildSearchText([
      bird.name,
      bird.oseaName,
      ...(bird.aliases || []),
      cn,
      en,
      latin,
      bird.place,
      bird.feature,
      bird.food,
      bird.clue,
    ]),
  };
}

function createBasicAtlasEntry(label, index) {
  const normalized = normalizeOseaLabel(label, index);
  const displayName = normalized.cn;

  return {
    index,
    name: displayName,
    cn: normalized.cn,
    en: normalized.en,
    latin: normalized.latin,
    habitat: "unknown",
    place: "分布资料待补充",
    feature: "已收录 OSEA 基础标签，详细形态、栖息地、食性和图片资料待补充。",
    food: "待补充",
    clue: "可先结合中文名、英文名、拉丁名和识别候选继续判断。",
    image: "",
    source: "",
    detailLevel: "basic",
    status: "基础标签",
    searchText: buildSearchText([normalized.cn, normalized.en, normalized.latin]),
  };
}

function buildAtlasEntries(labels) {
  const richByName = new Map(birds.map((bird) => [bird.name, bird]));
  const entries = labels.map((label, index) => {
    const normalized = normalizeOseaLabel(label, index);
    const mappedName = localAtlasMatches.get(index);
    const richBird =
      (mappedName && richByName.get(mappedName)) ||
      birds.find((bird) => bird.name === normalized.cn || bird.latin === normalized.latin);

    return richBird ? createRichAtlasEntry(richBird, index, normalized) : createBasicAtlasEntry(label, index);
  });

  return entries.sort((a, b) => {
    if (a.detailLevel !== b.detailLevel) {
      return a.detailLevel === "rich" ? -1 : 1;
    }

    return a.cn.localeCompare(b.cn, "zh-CN");
  });
}

function getAtlasEntries() {
  if (!atlasEntriesPromise) {
    atlasEntriesPromise = Promise.all([getBirdInfo(), getBirdProfiles()]).then(([labels]) =>
      buildAtlasEntries(labels)
    );
  }

  return atlasEntriesPromise;
}

function renderAtlasSummary(total, shown, matched, query, progress = null) {
  if (!atlasSummary) return;

  const sourceNote =
    birdProfilesSource === "fallback"
      ? ` 富图鉴资料文件暂不可用，已使用内置兜底资料。${birdProfilesLoadError ? `(${birdProfilesLoadError})` : ""}`
      : "";
  const progressNote = progress
    ? ` 富图鉴进度：${progress.richCount}/${progress.targetCount} 个候选已补齐。`
    : "";

  if (query) {
    atlasSummary.textContent =
      matched > shown
        ? `已索引 ${total.toLocaleString("zh-CN")} 个 OSEA 标签，找到 ${matched.toLocaleString("zh-CN")} 个结果，先显示前 ${shown} 个。${progressNote}${sourceNote}`
        : `已索引 ${total.toLocaleString("zh-CN")} 个 OSEA 标签，找到 ${matched.toLocaleString("zh-CN")} 个结果。${progressNote}${sourceNote}`;
    return;
  }

  atlasSummary.textContent = `已索引 ${total.toLocaleString("zh-CN")} 个 OSEA 标签；默认展示已补充图文的常见鸟和部分基础标签。${progressNote}${sourceNote}`;
}

function getAtlasInitialLimit() {
  if (window.matchMedia?.("(max-width: 560px)").matches) {
    return ATLAS_MOBILE_INITIAL_LIMIT;
  }

  if (window.matchMedia?.("(max-width: 920px)").matches) {
    return ATLAS_TABLET_INITIAL_LIMIT;
  }

  return ATLAS_INITIAL_LIMIT;
}

function getAtlasSearchLimit() {
  return window.matchMedia?.("(max-width: 560px)").matches
    ? ATLAS_MOBILE_SEARCH_LIMIT
    : ATLAS_SEARCH_LIMIT;
}

function renderAtlasCard(entry) {
  const isRich = entry.detailLevel === "rich";
  const hasImage = Boolean(isRich && entry.image);
  const caption = entry.imageCredit
    ? `${entry.imageCredit}${entry.license ? ` · ${entry.license}` : ""}`
    : "图片来源 Wikimedia";
  const photo = hasImage
    ? `
      <figure class="bird-photo">
        <img src="${escapeHtml(entry.image)}" alt="${escapeHtml(entry.name)}照片" loading="lazy" />
        <figcaption>${escapeHtml(caption)}</figcaption>
      </figure>
    `
    : `
      <figure class="bird-photo bird-placeholder" aria-label="${escapeHtml(entry.name)}待补充图片">
        <span>${escapeHtml(entry.cn.slice(0, 1))}</span>
        <figcaption>图片待补充</figcaption>
      </figure>
    `;
  const sourceLink = entry.source
    ? `<a class="source-link" href="${escapeHtml(entry.source)}" target="_blank" rel="noreferrer">查看来源</a>`
    : `<span class="source-link source-link-muted">来自 OSEA 标签库</span>`;

  return `
    <article class="bird-card ${isRich ? "is-rich" : "is-basic"}">
      ${photo}
      <div>
        <h3>${escapeHtml(entry.name)}</h3>
        <p>${escapeHtml(entry.en ? `${entry.en} · ${entry.latin}` : entry.latin)}</p>
        <p>${escapeHtml(entry.feature)}</p>
        <p class="bird-clue">${escapeHtml(entry.clue)}</p>
        <div class="tag-row">
          <span>${escapeHtml(entry.status)}</span>
          <span>${escapeHtml(entry.place)}</span>
        </div>
        <div class="atlas-card-actions">
          ${sourceLink}
          <button class="source-link atlas-open" type="button" data-atlas-index="${entry.index}">查看详情</button>
        </div>
      </div>
    </article>
  `;
}

function renderAtlasDetail(entry, context = "图鉴详情") {
  if (!atlasDetail || !entry) return;

  const imageRights = entry.image
    ? `${entry.imageCredit || "图片来源待补充"}${entry.license ? ` · ${entry.license}` : ""}`
    : "图片待补充";
  const sourceMarkup = entry.source
    ? `<a href="${escapeHtml(entry.source)}" target="_blank" rel="noreferrer">查看图片/资料来源</a>`
    : `<span>资料来源：OSEA 标签库，百科资料待补充</span>`;

  selectedAtlasIndex = entry.index;
  atlasDetail.innerHTML = `
    <div>
      <p class="eyebrow">${escapeHtml(context)}</p>
      <h3>${escapeHtml(entry.name)}</h3>
      <p>${escapeHtml(entry.en || "英文名待补充")} · ${escapeHtml(entry.latin || "拉丁名待补充")}</p>
    </div>
    <dl>
      <div><dt>资料状态</dt><dd>${escapeHtml(entry.status)}</dd></div>
      <div><dt>识别标签</dt><dd>OSEA index ${entry.index == null ? "待匹配" : entry.index}</dd></div>
      <div><dt>栖息地</dt><dd>${escapeHtml(entry.place)}</dd></div>
      <div><dt>观察线索</dt><dd>${escapeHtml(entry.clue)}</dd></div>
      <div><dt>食性</dt><dd>${escapeHtml(entry.food)}</dd></div>
      <div><dt>图片版权</dt><dd>${escapeHtml(imageRights)}</dd></div>
      <div><dt>来源</dt><dd>${sourceMarkup}</dd></div>
    </dl>
  `;
}

async function openAtlasDetailByIndex(index, options = {}) {
  const entries = await getAtlasEntries();
  const entry = entries.find((item) => item.index === index);
  if (!entry) return;

  renderAtlasDetail(entry, options.context || "图鉴详情");

  if (options.syncSearch && birdSearch) {
    birdSearch.value = entry.cn;
    await renderBirds({ keepDetail: true });
  }

  if (options.scroll && atlasDetail) {
    atlasDetail.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

async function renderBirds(options = {}) {
  if (!birdGrid || !birdSearch) return;

  const query = birdSearch.value.trim().toLowerCase();
  birdGrid.classList.remove("is-empty");
  birdGrid.classList.remove("is-marquee");
  birdGrid.innerHTML = `<article class="bird-card atlas-loading"><div><h3>正在加载图鉴索引</h3><p>正在读取 OSEA 鸟类标签库...</p></div></article>`;

  try {
    const [entries, commonBirdCandidates] = await Promise.all([
      getAtlasEntries(),
      getCommonBirdCandidates(),
    ]);
    const matched = query
      ? entries.filter((entry) => entry.searchText.includes(query))
      : entries;
    const initialLimit = getAtlasInitialLimit();
    const visible = query
      ? matched.slice(0, getAtlasSearchLimit())
      : [
          ...entries.filter((entry) => entry.detailLevel === "rich"),
          ...entries.filter((entry) => entry.detailLevel !== "rich").slice(0, initialLimit),
        ].slice(0, initialLimit);
    const candidateIndexSet = new Set(commonBirdCandidates.map((candidate) => candidate.oseaIndex));
    const progress = commonBirdCandidates.length
      ? {
          richCount: entries.filter(
            (entry) => entry.detailLevel === "rich" && candidateIndexSet.has(entry.index)
          ).length,
          targetCount: commonBirdCandidates.length,
        }
      : null;

    renderAtlasSummary(entries.length, visible.length, matched.length, query, progress);

    if (visible[0] && !options.keepDetail) {
      renderAtlasDetail(visible[0], query ? "搜索结果详情" : "默认展示");
    }

    if (!visible.length) {
      birdGrid.classList.add("is-empty");
      birdGrid.classList.remove("is-marquee");
      birdGrid.innerHTML =
        `<article class="bird-card"><div><h3>没有找到鸟种</h3><p>可以换一个中文名、英文名或拉丁名再试。</p></div></article>`;
      return;
    }

    birdGrid.classList.remove("is-empty");
    birdGrid.classList.toggle("is-marquee", !query);
    birdGrid.innerHTML = query
      ? `
        <div class="atlas-results">
          ${visible.map(renderAtlasCard).join("")}
        </div>
      `
      : renderAtlasMarquee(visible);
  } catch (error) {
    birdGrid.classList.add("is-empty");
    birdGrid.classList.remove("is-marquee");
    birdGrid.innerHTML =
      `<article class="bird-card"><div><h3>图鉴加载失败</h3><p>${escapeHtml(error.message || "请稍后重试。")}</p></div></article>`;
    if (atlasSummary) {
      atlasSummary.textContent = "图鉴索引加载失败。";
    }
  }
}

function renderAtlasMarquee(entries) {
  const cards = entries.map(renderAtlasCard).join("");

  return `
    <div class="bird-marquee" aria-label="默认鸟类卡片滚动列表">
      <div class="bird-track">${cards}</div>
      <div class="bird-track" aria-hidden="true">${cards}</div>
    </div>
  `;
}

function initAtlasSearch() {
  if (!birdSearch) return;

  birdSearch.addEventListener("input", () => {
    window.clearTimeout(atlasSearchTimer);
    atlasSearchTimer = window.setTimeout(() => {
      renderBirds();
    }, 120);
  });

  if (birdGrid) {
    birdGrid.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-atlas-index]");
      if (!trigger) return;

      openAtlasDetailByIndex(Number(trigger.dataset.atlasIndex), {
        context: "图鉴详情",
        scroll: true,
      });
    });
  }

  if (candidateList) {
    candidateList.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-candidate-index]");
      if (!trigger) return;

      openAtlasDetailByIndex(Number(trigger.dataset.candidateIndex), {
        context: "识别候选详情",
        syncSearch: true,
        scroll: true,
      });
    });
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatCandidateScore(probability) {
  const percent = probability * 100;
  if (!Number.isFinite(percent) || percent <= 0) return "0%";
  if (percent >= 10) return `${Math.round(percent)}%`;
  if (percent >= 1) return `${percent.toFixed(1)}%`;
  return "<1%";
}

function displayConfidence(probability) {
  const percent = Math.round(probability * 100);
  return Math.max(1, Math.min(99, percent));
}

function setConfidenceRing(confidence, color = "var(--green)") {
  if (!confidenceRing) return;

  confidenceRing.style.background = `
    radial-gradient(circle at center, #fff 55%, transparent 56%),
    conic-gradient(${color} 0 ${confidence}%, #e9f0ec ${confidence}% 100%)
  `;
}

function updateRecognitionActions() {
  const canUseResult = lastRecognitionStatus === "success";
  const shareDetectedButton = document.querySelector("#shareDetected");

  [shareDetectedButton, useDetected].forEach((button) => {
    if (!button) return;
    button.disabled = !canUseResult;
    button.setAttribute("aria-disabled", String(!canUseResult));
  });
}

function setCandidateListMessage(message) {
  if (!candidateList) return;

  candidateList.innerHTML = `
    <li class="candidate-empty">${escapeHtml(message)}</li>
  `;
}

function renderCandidateList(candidates = []) {
  if (!candidateList) return;

  if (!candidates.length) {
    setCandidateListMessage("上传照片后显示模型 Top 5 候选。");
    return;
  }

  candidateList.innerHTML = candidates
    .map((candidate, index) => {
      const latin = candidate.latin ? ` · ${candidate.latin}` : "";
      const atlasNote = candidate.atlasBird ? "图鉴已收录" : "图鉴待补充";

      return `
        <li>
          <button class="candidate-open" type="button" data-candidate-index="${candidate.index}">
            <span>
              <strong>${index + 1}. ${escapeHtml(candidate.cn)}</strong>
              <small>${escapeHtml(candidate.en || "英文名待补充")}${escapeHtml(latin)}</small>
            </span>
            <span>
              <b>${escapeHtml(formatCandidateScore(candidate.probability))}</b>
              <em>${escapeHtml(atlasNote)}</em>
            </span>
          </button>
        </li>
      `;
    })
    .join("");
}

function createCandidateBird(candidate) {
  return {
    name: candidate.cn,
    latin: candidate.latin || candidate.en || "OSEA 标签",
    place: "图鉴资料待补充",
    feature: `${candidate.cn}${candidate.en ? ` / ${candidate.en}` : ""} 是 OSEA 全量标签库返回的候选结果，当前本地图鉴还没有补充详细资料。`,
    food: "待补充",
    clue: "建议结合照片主体大小、拍摄地点和 Top 候选继续判断。",
  };
}

function setResult(
  bird,
  confidence = 92,
  detail = "模型已匹配到图鉴中的常见鸟种。",
  candidates = []
) {
  if (!confidenceText || !resultName || !resultMeta || !resultFeature || !modelDetail) return;

  detectedBird = bird;
  lastRecognitionStatus = "success";
  confidenceText.textContent = `${confidence}%`;
  resultName.textContent = bird.name;
  resultMeta.textContent = `${bird.latin} · ${bird.place}`;
  resultFeature.textContent = bird.feature;
  modelDetail.textContent = detail;
  renderCandidateList(candidates);
  setConfidenceRing(confidence);
  updateRecognitionActions();
}

function setPendingResult(text) {
  if (!confidenceText || !resultName || !resultMeta || !resultFeature || !modelDetail) return;

  lastRecognitionStatus = "pending";
  confidenceText.textContent = "...";
  resultName.textContent = "正在识别";
  resultMeta.textContent = "AI 模型正在分析这张照片";
  resultFeature.textContent = "请稍等几秒，首次加载模型可能会更慢。";
  modelDetail.textContent = text;
  setCandidateListMessage("模型运行完成后会显示 Top 5 候选。");
  setConfidenceRing(100, "#9ba9a2");
  updateRecognitionActions();
}

function setUnknownResult(predictions, candidates = []) {
  if (!confidenceText || !resultName || !resultMeta || !resultFeature || !modelDetail) return;

  lastRecognitionStatus = "unknown";
  confidenceText.textContent = "--";
  resultName.textContent = "未确定鸟种";
  resultMeta.textContent = "建议换一张更清晰、主体更大的鸟类照片";
  resultFeature.textContent = "当前模型没有给出足够稳定的全量标签候选。";
  modelDetail.textContent = predictions || "模型没有返回可用结果。";
  renderCandidateList(candidates);
  setConfidenceRing(100, "#9ba9a2");
  updateRecognitionActions();
}

function setCandidateResult(result) {
  const top = result.top;
  const bird = top.atlasBird || createCandidateBird(top);
  const confidence = displayConfidence(top.probability);
  const detail = top.atlasBird
    ? `OSEA 全量 ${result.labelCount.toLocaleString("zh-CN")} 个标签 Top 1：${top.cn} / ${top.en}。`
    : `OSEA 全量 ${result.labelCount.toLocaleString("zh-CN")} 个标签 Top 1：${top.cn} / ${top.en}，本地图鉴资料待补充。`;

  setResult(bird, confidence, detail, result.candidates);
}

function initBirdRecognition() {
  if (!upload || !preview || !uploadZone) return;

  updateRecognitionActions();

  upload.addEventListener("change", async () => {
    const file = upload.files[0];
    if (!file) return;
    const runId = ++recognitionRunId;
    uploadZone.classList.remove("has-image");
    setPendingResult("正在加载/运行 OSEA 鸟类识别模型...");

    let objectUrl = "";
    try {
      objectUrl = URL.createObjectURL(file);
      await new Promise((resolve, reject) => {
        preview.onload = resolve;
        preview.onerror = reject;
        preview.src = objectUrl;
      });

      URL.revokeObjectURL(objectUrl);
      objectUrl = "";
      if (runId !== recognitionRunId) return;

      uploadZone.classList.add("has-image");
      const result = await classifyImageElement(preview);
      if (runId !== recognitionRunId) return;

      if (!result.top) {
        setUnknownResult("模型没有返回可用候选。");
        return;
      }

      if (!result.isConfident) {
        setUnknownResult(
          `Top 1 为 ${result.top.cn}，置信度 ${formatCandidateScore(result.top.probability)}，低于上线阈值。`,
          result.candidates
        );
        return;
      }

      setCandidateResult(result);
    } catch (error) {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
      if (runId !== recognitionRunId) return;
      lastRecognitionStatus = "failed";
      uploadZone.classList.remove("has-image");
      preview.removeAttribute("src");
      confidenceText.textContent = "!";
      resultName.textContent = "识别失败";
      resultMeta.textContent = "模型加载或图片读取失败";
      resultFeature.textContent = "请确认使用 http://localhost 或正式网址打开，而不是直接 file:// 打开。";
      modelDetail.textContent = error.message || "未知错误";
      setCandidateListMessage("识别失败，暂无候选结果。");
      setConfidenceRing(100, "#b36b5e");
      updateRecognitionActions();
    }
  });
}

function initPublishing() {
  if (postForm && postTitle && postBody) {
    postForm.addEventListener("submit", (event) => {
      event.preventDefault();

      const title = normalizeUserText(postTitle.value, POST_TITLE_MAX_LENGTH);
      const body = normalizeUserText(postBody.value, POST_BODY_MAX_LENGTH);
      if (!title || !body) {
        (title ? postBody : postTitle).focus();
        return;
      }

      const newPost = {
        id: createPostId(),
        title,
        body,
        bird: detectedBird.name,
        time: "刚刚",
        author: currentUser?.nickname || "我",
        ownerEmail: currentUser?.email || "",
        source: "mine",
      };

      userPosts.unshift(newPost);
      saveUserPosts();
      postForm.reset();
      renderCurrentFeed();
    });
  }

  if (useDetected && postTitle && postBody) {
    useDetected.addEventListener("click", () => {
      if (lastRecognitionStatus !== "success") {
        upload?.focus();
        return;
      }

      postTitle.value = `今天观察到 ${detectedBird.name}`;
      postBody.value = `${detectedBird.name}，${detectedBird.feature} 观察地点可以补充为公园、湿地或校园。`;
      postBody.focus();
    });
  }

  const shareDetectedButton = document.querySelector("#shareDetected");
  if (shareDetectedButton) {
    updateRecognitionActions();
    shareDetectedButton.addEventListener("click", () => {
      if (lastRecognitionStatus !== "success") {
        upload?.focus();
        return;
      }

      userPosts.unshift({
        id: createPostId(),
        title: `我识别到了一只 ${detectedBird.name}`,
        body: `${detectedBird.feature} 这条记录已从 AI 识别结果生成。`,
        bird: detectedBird.name,
        time: "刚刚",
        author: currentUser?.nickname || "我",
        ownerEmail: currentUser?.email || "",
        source: "mine",
      });
      saveUserPosts();
      renderCurrentFeed();
      document.querySelector("#community")?.scrollIntoView({ behavior: "smooth" });
    });
  }
}

function initScrollButtons() {
  document.querySelectorAll("[data-scroll]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector(button.dataset.scroll)?.scrollIntoView({ behavior: "smooth" });
    });
  });
}

function getSavedDeviceConnectionState() {
  const saved = window.localStorage.getItem(STORAGE_KEYS.deviceConnected);
  return saved === "connected" || saved === "true" ? "connected" : "disconnected";
}

function updateDeviceConnectionUI(state) {
  if (
    !deviceConnectionTitle ||
    !deviceConnectBtn ||
    !deviceBatteryValue ||
    !deviceStorageValue ||
    !deviceFirmwareValue ||
    !deviceSyncStatus
  ) {
    return;
  }

  const isConnecting = state === "connecting";
  const isConnected = state === "connected";

  deviceConnectionTitle.textContent = `Birdora Glasses ${isConnecting ? "连接中" : isConnected ? "已连接" : "未连接"}`;
  deviceConnectBtn.textContent = isConnecting ? "连接中..." : isConnected ? "断开连接" : "连接设备";
  deviceConnectBtn.disabled = isConnecting;
  deviceConnectBtn.classList.toggle("is-connecting", isConnecting);
  deviceConnectBtn.setAttribute("aria-busy", String(isConnecting));
  deviceConnectBtn.setAttribute("data-device-state", state);
  deviceBatteryValue.textContent = isConnected ? "86%" : "—";
  deviceStorageValue.textContent = isConnected ? "32.4GB" : "—";
  deviceFirmwareValue.textContent = isConnected ? "V2.0.5" : "—";
  deviceSyncStatus.textContent = isConnecting
    ? "正在搜索附近的 Birdora Glasses..."
    : isConnected
      ? "蓝牙在线 · 最近同步 3 分钟前"
      : "蓝牙未连接";
  deviceSyncStatus.classList.toggle("is-connecting", isConnecting);
}

function initDeviceConnection() {
  if (!deviceConnectBtn) return;

  updateDeviceConnectionUI(getSavedDeviceConnectionState());

  deviceConnectBtn.addEventListener("click", () => {
    const currentState = deviceConnectBtn.dataset.deviceState || "disconnected";

    if (currentState === "connecting") {
      return;
    }

    if (currentState === "connected") {
      window.clearTimeout(deviceConnectionTimer);
      window.localStorage.setItem(STORAGE_KEYS.deviceConnected, "disconnected");
      deviceConnectionTimer = null;
      updateDeviceConnectionUI("disconnected");
      return;
    }

    updateDeviceConnectionUI("connecting");
    window.clearTimeout(deviceConnectionTimer);
    deviceConnectionTimer = window.setTimeout(() => {
      window.localStorage.setItem(STORAGE_KEYS.deviceConnected, "connected");
      updateDeviceConnectionUI("connected");
      deviceConnectionTimer = null;
    }, 1500);
  });
}

function syncHomeCommunityReveal() {
  if (page === "community") return;

  const preview = document.querySelector("#community .feed-preview");
  if (!preview) return;

  const revealItems = [
    ...preview.querySelectorAll(".feed-card"),
    ...preview.querySelectorAll(".more-link"),
  ];
  if (!revealItems.length) return;

  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  revealItems.forEach((item, index) => {
    item.classList.add("reveal-card");
    item.style.transitionDelay = homeCommunityRevealPlayed || prefersReducedMotion ? "0ms" : `${index * 120}ms`;
    item.classList.toggle("is-visible", homeCommunityRevealPlayed || prefersReducedMotion);
  });
}

function initHomeCommunityReveal() {
  if (page === "community") return;

  const preview = document.querySelector("#community .feed-preview");
  if (!preview) return;

  syncHomeCommunityReveal();

  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (prefersReducedMotion) {
    homeCommunityRevealPlayed = true;
    return;
  }

  if (homeCommunityRevealPlayed) return;

  homeCommunityRevealObserver?.disconnect();
  homeCommunityRevealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        homeCommunityRevealPlayed = true;
        syncHomeCommunityReveal();
        observer.disconnect();
      });
    },
    {
      threshold: 0.22,
      rootMargin: "0px 0px -10% 0px",
    }
  );

  homeCommunityRevealObserver.observe(preview);
}

function initSoftReveal() {
  const sections = document.querySelectorAll(
    ".hero, .hero-section, .identify-section, #identify, .bird-section, .atlas-section, #atlas, .community-section, #community, .device-section, #device"
  );
  if (!sections.length) return;

  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  sections.forEach((section) => section.classList.add("reveal-on-scroll"));

  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    sections.forEach((section) => section.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    {
      threshold: 0.16,
      rootMargin: "0px 0px -8% 0px",
    }
  );

  sections.forEach((section) => observer.observe(section));
}

async function initLoginPage() {
  const status = await fetchAuthStatus();
  if (status.authenticated && status.user) {
    rememberAuthUser(status.user);
    window.location.replace("./index.html");
    return;
  }

  clearAuthState();
  initAuthForms();
}

async function initAuthenticatedPage() {
  if (!(await requireAuth())) {
    return;
  }

  await getBirdProfiles();
  loadUserPosts();
  loadComments();
  renderBirds();
  initAtlasSearch();
  renderCurrentFeed();
  updateModelReadiness();
  bindCommentFeed(feed);
  bindCommentFeed(communityFeed);
  initCommunityTabs();
  initLogoutButtons();
  initBirdRecognition();
  initPublishing();
  initScrollButtons();
  initDeviceConnection();
  initHomeCommunityReveal();
  initSoftReveal();

  if (new URLSearchParams(window.location.search).has("selftest")) {
    window.setTimeout(async () => {
      try {
        setPendingResult("正在用本地翠鸟照片自测 OSEA 模型...");
        const testImage = new Image();
        testImage.src = "./assets/birds/kingfisher.jpg";
        await new Promise((resolve, reject) => {
          testImage.onload = resolve;
          testImage.onerror = reject;
        });
        const result = await classifyImageElement(testImage);
        if (!result.top) throw new Error("自测没有返回候选结果。");
        if (!result.isConfident) {
          throw new Error(`自测 Top 1 为 ${result.top.cn}，但置信度低于上线阈值。`);
        }
        setCandidateResult(result);
        modelDetail.textContent = `自测通过：OSEA 全量 Top 1 返回 ${result.top.cn} / ${result.top.en}。`;
      } catch (error) {
        confidenceText.textContent = "!";
        resultName.textContent = "OSEA 自测失败";
        resultMeta.textContent = "模型、WASM 或资源路径需要检查";
        resultFeature.textContent = "请使用本地服务器或正式网址访问，不要直接用 file:// 打开 OSEA 版本。";
        modelDetail.textContent = error.message || "未知错误";
        setCandidateListMessage("自测失败，暂无候选结果。");
      }
    }, 800);
  }
}

function initApp() {
  if (page === "login") {
    initLoginPage();
  } else if (AUTH_PAGES.has(page)) {
    initAuthenticatedPage();
  } else {
    initSoftReveal();
  }
}

initApp();
