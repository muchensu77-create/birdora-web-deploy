const page = document.body.dataset.page || "home";

function renderHomeObservationDate() {
  const dateLabel = document.querySelector("#homeObservationDate");
  if (!dateLabel) return;
  const today = new Date();
  dateLabel.textContent = `${today.getMonth() + 1}月${today.getDate()}日`;
}

renderHomeObservationDate();

const STORAGE_KEYS = {
  comments: "birdora-post-comments",
  communityTab: "birdora-community-tab",
  deviceConnected: "birdora-device-connected",
};
const LEGACY_AUTH_STORAGE_KEYS = ["birdoraLoggedIn", "birdora-auth-user"];

// Authentication is restored from the HttpOnly session cookie via /api/auth/status.
// Remove legacy browser copies because they may contain an email or profile fields.
try {
  LEGACY_AUTH_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
} catch {
  // Storage may be unavailable; the server session remains the source of truth.
}

const APP_PAGES = new Set(["home", "community", "explore", "profile", "upload", "publish", "device"]);
const AUTH_API_BASE_URL = resolveAuthApiBaseUrl();
const AUTH_ROUTES = {
  register: "/api/auth/register",
  login: "/api/auth/login",
  logout: "/api/auth/logout",
  me: "/api/auth/me",
  status: "/api/auth/status",
};
const CAPABILITIES_ROUTE = "/api/v1/capabilities";
const CAPABILITIES_UNAVAILABLE_REASON = "无法确认服务端功能状态，为保障数据安全，此操作已停用。";
const DEFAULT_COMMUNITY_IMAGE_MAX_BYTES = 1024 * 1024;
const DEFAULT_COMMUNITY_VIDEO_MAX_BYTES = 8 * 1024 * 1024;
const SAFE_CAPABILITY_DEFAULTS = Object.freeze({
  accountDeletion: false,
  communityPublish: false,
  communityPostEdit: false,
  communityLegacyLike: false,
  socialFeedV1: false,
  canonicalLike: false,
  cloudDrafts: false,
  notifications: false,
  sse: false,
});
let runtimeCapabilities = {
  status: "loading",
  features: { ...SAFE_CAPABILITY_DEFAULTS },
  limits: {
    communityImageBytes: DEFAULT_COMMUNITY_IMAGE_MAX_BYTES,
    communityVideoBytes: DEFAULT_COMMUNITY_VIDEO_MAX_BYTES,
  },
  disabledReasons: {},
  error: "",
};
let runtimeCapabilitiesPromise = null;
const API_REQUEST_TIMEOUT_MS =
  Number(window.BIRDORA_API_REQUEST_TIMEOUT_MS) > 0
    ? Number(window.BIRDORA_API_REQUEST_TIMEOUT_MS)
    : 15000;
const communityApi = window.BirdoraCommunityApi.createCommunityApi({
  baseUrl: AUTH_API_BASE_URL,
  timeoutMs: API_REQUEST_TIMEOUT_MS,
});
const observationApi = window.BirdoraObservationApi?.createObservationApi({
  baseUrl: AUTH_API_BASE_URL,
  timeoutMs: API_REQUEST_TIMEOUT_MS,
});
const OSEA_LABELS_PATH = "./assets/osea/bird_info.json";
const OSEA_MODEL_PATH = "./assets/osea/bird_model.onnx";
const BIRD_PROFILES_PATH = "./assets/atlas/bird-profiles.json";
const COMMON_BIRD_CANDIDATES_PATH = "./assets/atlas/common-bird-candidates.json";
const OSEA_TOP_K = 5;
const OSEA_CONFIDENCE_THRESHOLD = 0.05;
const OSEA_EXPECTED_OUTPUT_COUNT = 11000;
const OSEA_MODEL_LOAD_TIMEOUT_MS =
  Number(window.BIRDORA_OSEA_MODEL_LOAD_TIMEOUT_MS) > 0
    ? Number(window.BIRDORA_OSEA_MODEL_LOAD_TIMEOUT_MS)
    : 60000;
const OSEA_LABEL_LOAD_TIMEOUT_MS =
  Number(window.BIRDORA_OSEA_LABEL_LOAD_TIMEOUT_MS) > 0
    ? Number(window.BIRDORA_OSEA_LABEL_LOAD_TIMEOUT_MS)
    : 15000;
const RECOGNITION_SERVER_TIMEOUT_MS =
  Number(window.BIRDORA_RECOGNITION_SERVER_TIMEOUT_MS) > 0
    ? Number(window.BIRDORA_RECOGNITION_SERVER_TIMEOUT_MS)
    : 90000;
const RECOGNITION_IMAGE_LOAD_TIMEOUT_MS = 15000;
const HEIC_CONVERTER_PATH = "./assets/vendor/heic-to.js";
const ATLAS_INITIAL_LIMIT = 12;
const ATLAS_SEARCH_LIMIT = 24;
const ATLAS_TABLET_INITIAL_LIMIT = 12;
const ATLAS_MOBILE_INITIAL_LIMIT = 8;
const ATLAS_MOBILE_SEARCH_LIMIT = 12;
const ATLAS_DEFAULT_HIDDEN_INDEXES = new Set([3334]);
const ATLAS_TOUCH_MARQUEE_QUERY = "(max-width: 920px)";
const ATLAS_TOUCH_MARQUEE_SPEED = 24;
const ATLAS_TOUCH_MARQUEE_RESUME_DELAY_MS = 1100;
const POST_TITLE_MAX_LENGTH = 80;
const POST_BODY_MAX_LENGTH = 600;
const COMMENT_MAX_LENGTH = 180;
const COMMENT_PAGE_SIZE = 10;
const QUESTION_MAX_LENGTH = 180;
const POST_IMAGE_MAX_BYTES = 1024 * 1024;
const COMMUNITY_PAGE_SIZE = 20;
const OBSERVATION_PAGE_SIZE = 20;
const OBSERVATION_IMAGE_MAX_BYTES = 1024 * 1024;
const OBSERVATION_IMAGE_MAX_DIMENSION = 1280;

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
const saveObservationButton = document.querySelector("#saveObservation");
const observationMessage = document.querySelector("#observationMessage");
const observationList = document.querySelector("#observationList");
const feed = document.querySelector("#feed");
const communityFeed = document.querySelector("#communityFeed");
const postForm = document.querySelector("#postForm");
const postTitle = document.querySelector("#postTitle");
const postBody = document.querySelector("#postBody");
const postImage = document.querySelector("#postImage");
const postImageName = document.querySelector("#postImageName");
const postMessage = document.querySelector("#postMessage");
const useDetected = document.querySelector("#useDetected");
const communityTabs = document.querySelectorAll("[data-community-tab]");
const logoutButtons = document.querySelectorAll("[data-logout]");
const loginLinks = document.querySelectorAll("[data-login-link]");
const registerLinks = document.querySelectorAll("[data-register-link]");
const authForms = document.querySelectorAll("[data-auth-form]");
const authSwitchButtons = document.querySelectorAll("[data-auth-switch]");
const authModeFields = document.querySelectorAll("[data-auth-visible]");
const authModeEyebrow = document.querySelector("#authModeEyebrow");
const authModeTitle = document.querySelector("#authModeTitle");
const authModeCopy = document.querySelector("#authModeCopy");
const authSubmitBtn = document.querySelector("#authSubmitBtn");
const authSwitchLead = document.querySelector("#authSwitchLead");
const authPageSwitchLink = document.querySelector(".auth-switch-btn");
const userNameBadges = document.querySelectorAll("[data-user-name]");
const deviceConnectionTitle = document.querySelector("#deviceConnectionTitle");
const deviceConnectBtn = document.querySelector("#deviceConnectBtn");
const deviceBatteryValue = document.querySelector("#deviceBatteryValue");
const deviceStorageValue = document.querySelector("#deviceStorageValue");
const deviceFirmwareValue = document.querySelector("#deviceFirmwareValue");
const deviceSyncStatus = document.querySelector("#deviceSyncStatus");
const deviceToolMessage = document.querySelector("#deviceToolMessage");
const speciesCountBadges = document.querySelectorAll("[data-species-count]");
const monthSpeciesCountBadges = document.querySelectorAll("[data-month-species-count]");

window.__birdoraAuthFormsReady = false;
window.__birdoraLogoutReady = false;
window.__birdoraRecognitionReady = false;
window.__birdoraPublishingReady = false;

const expandedComments = new Set();
const emptyCommentsPageInfo = { limit: COMMENT_PAGE_SIZE, offset: 0, nextOffset: 0, hasMore: false, total: 0, commentCount: 0 };

let detectedBird = birds[0];
let classifierPromise;
let birdInfoPromise;
let birdProfilesPromise;
let commonBirdCandidatesPromise;
let atlasEntriesPromise;
let atlasSearchTimer = null;
let atlasRenderRunId = 0;
let atlasMarqueeAutoScrollFrame = null;
let atlasMarqueeAutoScrollLastTime = 0;
let atlasMarqueeResumeTimer = null;
let atlasMarqueeUserActive = false;
let selectedAtlasIndex = null;
let birdProfilesSource = "fallback";
let birdProfilesLoadError = "";
let communityPosts = [];
let userPosts = [];
let observations = [];
let communityLoadState = "loading";
let communityLoadMessage = "";
let communityPageInfo = { limit: COMMUNITY_PAGE_SIZE, offset: 0, nextOffset: 0, hasMore: false };
let observationsLoadState = "idle";
let observationsLoadMessage = "";
let observationsPageInfo = { limit: OBSERVATION_PAGE_SIZE, offset: 0, nextOffset: 0, hasMore: false };
let activeCommunityTab = "recommended";
let editingPostId = "";
let currentUser = null;
let homeCommunityRevealPlayed = false;
let homeCommunityRevealObserver = null;
let deviceConnectionTimer = null;
let localAtlasMatches = new Map();
let communityTabsBound = false;
let recognitionRunId = 0;
let lastRecognitionStatus = "idle";
let currentRecognitionShareKey = "";
let lastSharedRecognitionKey = "";
let currentRecognitionCandidates = [];
let selectedRecognitionCandidate = null;
let currentRecognitionImagePayload = null;
let currentRecognitionSource = "osea-browser";
let savedObservation = null;
let lastSavedRecognitionKey = "";
let heicConverterPromise = null;
let activeDetailPostId = "";
let detailPost = null;
let detailComments = [];
let detailCommentsPageInfo = { ...emptyCommentsPageInfo };
let detailLoadState = "idle";
let detailLoadMessage = "";
let detailDialogBound = false;

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
        birdProfilesPromise = null;
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
        commonBirdCandidatesPromise = null;
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
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function getCurrentPagePath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function getLoginUrl() {
  return `./login.html?next=${encodeURIComponent(getCurrentPagePath())}`;
}

function getRegisterUrl() {
  return `./register.html?next=${encodeURIComponent(getCurrentPagePath())}`;
}

function getAuthSwitchUrl(targetMode) {
  const targetUrl = targetMode === "register" ? "./register.html" : "./login.html";
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next) return targetUrl;

  try {
    const url = new URL(next, window.location.href);
    if (url.origin !== window.location.origin) return targetUrl;
    const safeNext = `${url.pathname}${url.search}${url.hash}`;
    return `${targetUrl}?next=${encodeURIComponent(safeNext)}`;
  } catch {
    return targetUrl;
  }
}

function getPostLoginUrl() {
  const next = new URLSearchParams(window.location.search).get("next");
  if (!next) return "./index.html";

  try {
    const url = new URL(next, window.location.href);
    if (url.origin !== window.location.origin) {
      return "./index.html";
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "./index.html";
  }
}

function requireLoginForAction() {
  if (currentUser) return true;

  window.location.href = getLoginUrl();
  return false;
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

function isCapabilityEnabled(feature) {
  return runtimeCapabilities.status === "ready" && runtimeCapabilities.features[feature] === true;
}

function getCapabilityDisabledReason(feature) {
  if (isCapabilityEnabled(feature)) return "";
  if (runtimeCapabilities.status !== "ready") {
    return CAPABILITIES_UNAVAILABLE_REASON;
  }
  return runtimeCapabilities.disabledReasons[feature] || "服务端暂未开放此功能。";
}

function getCommunityUploadLimit(kind) {
  const fallback = kind === "video"
    ? DEFAULT_COMMUNITY_VIDEO_MAX_BYTES
    : DEFAULT_COMMUNITY_IMAGE_MAX_BYTES;
  const key = kind === "video" ? "communityVideoBytes" : "communityImageBytes";
  const configured = Number(runtimeCapabilities.limits[key]);
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, fallback)
    : fallback;
}

async function loadRuntimeCapabilities() {
  if (runtimeCapabilitiesPromise) return runtimeCapabilitiesPromise;

  runtimeCapabilitiesPromise = (async () => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${AUTH_API_BASE_URL}${CAPABILITIES_ROUTE}`, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`能力配置请求失败：${response.status}`);
      }

      const payload = await response.json();
      const data = payload?.data;
      if (!data || typeof data !== "object" || !data.features || typeof data.features !== "object") {
        throw new Error("能力配置返回格式不正确。");
      }

      const features = { ...SAFE_CAPABILITY_DEFAULTS };
      Object.keys(features).forEach((feature) => {
        features[feature] = data.features[feature] === true;
      });
      const disabledReasons = {};
      if (data.disabledReasons && typeof data.disabledReasons === "object") {
        Object.keys(features).forEach((feature) => {
          if (typeof data.disabledReasons[feature] === "string" && data.disabledReasons[feature].trim()) {
            disabledReasons[feature] = data.disabledReasons[feature].trim();
          }
        });
      }

      runtimeCapabilities = {
        status: "ready",
        features,
        limits: {
          communityImageBytes: Number(data.limits?.communityImageBytes) || DEFAULT_COMMUNITY_IMAGE_MAX_BYTES,
          communityVideoBytes: Number(data.limits?.communityVideoBytes) || DEFAULT_COMMUNITY_VIDEO_MAX_BYTES,
        },
        disabledReasons,
        error: "",
      };
    } catch (error) {
      runtimeCapabilities = {
        status: "error",
        features: { ...SAFE_CAPABILITY_DEFAULTS },
        limits: {
          communityImageBytes: DEFAULT_COMMUNITY_IMAGE_MAX_BYTES,
          communityVideoBytes: DEFAULT_COMMUNITY_VIDEO_MAX_BYTES,
        },
        disabledReasons: {},
        error: error?.message || "能力配置加载失败。",
      };
    } finally {
      window.clearTimeout(timeoutId);
    }

    return runtimeCapabilities;
  })();

  return runtimeCapabilitiesPromise;
}

function setCapabilityControlledDisabled(control, disabled, reason = "") {
  if (!control) return;
  if (disabled) {
    if (control.dataset.capabilityDisabled !== "true") {
      control.dataset.capabilityOriginalTitle = control.getAttribute("title") || "";
      control.dataset.capabilityOriginalAriaLabel = control.getAttribute("aria-label") || "";
    }
    control.disabled = true;
    control.dataset.capabilityDisabled = "true";
    control.title = reason;
    control.setAttribute("aria-label", `${control.textContent?.trim() || "此操作"}：${reason}`);
    return;
  }
  if (control.dataset.capabilityDisabled === "true") {
    control.disabled = false;
  }
  const originalTitle = control.dataset.capabilityOriginalTitle || "";
  const originalAriaLabel = control.dataset.capabilityOriginalAriaLabel || "";
  if (originalTitle) control.title = originalTitle;
  else control.removeAttribute("title");
  if (originalAriaLabel) control.setAttribute("aria-label", originalAriaLabel);
  else control.removeAttribute("aria-label");
  delete control.dataset.capabilityDisabled;
  delete control.dataset.capabilityOriginalTitle;
  delete control.dataset.capabilityOriginalAriaLabel;
}

function setCapabilityMessage(target, message = "") {
  if (!target) return;
  const previous = target.dataset.capabilityMessage || "";
  if (message) {
    if (!target.textContent.trim() || target.textContent.trim() === previous) {
      target.textContent = message;
    }
    target.dataset.capabilityMessage = message;
    return;
  }
  if (previous && target.textContent.trim() === previous) {
    target.textContent = "";
  }
  delete target.dataset.capabilityMessage;
}

function applyRuntimeCapabilityControls() {
  const canPublish = isCapabilityEnabled("communityPublish");
  const publishReason = getCapabilityDisabledReason("communityPublish");
  document.querySelectorAll('#postForm [type="submit"], [data-observation-share], [data-community-publish-submit]').forEach((control) => {
    setCapabilityControlledDisabled(control, !canPublish, publishReason);
  });
  setCapabilityMessage(document.querySelector("#postMessage"), canPublish ? "" : publishReason);
  setCapabilityMessage(document.querySelector("[data-community-publish-reason]"), canPublish ? "" : publishReason);

  const canEdit = isCapabilityEnabled("communityPostEdit");
  const editReason = getCapabilityDisabledReason("communityPostEdit");
  document.querySelectorAll("[data-post-edit], [data-post-edit-form] [type=submit]").forEach((control) => {
    setCapabilityControlledDisabled(control, !canEdit, editReason);
  });
  document.querySelectorAll("[data-post-edit-message]").forEach((message) => {
    setCapabilityMessage(message, canEdit ? "" : editReason);
  });

  const canUseLegacyLike = isCapabilityEnabled("communityLegacyLike");
  const legacyLikeReason = getCapabilityDisabledReason("communityLegacyLike");
  document.querySelectorAll("[data-workspace-like], [data-post-reaction]").forEach((control) => {
    setCapabilityControlledDisabled(control, !canUseLegacyLike, legacyLikeReason);
  });

  const canDeleteAccount = isCapabilityEnabled("accountDeletion");
  const accountReason = getCapabilityDisabledReason("accountDeletion");
  [
    document.querySelector("[data-profile-delete]"),
    document.querySelector("#profileDeletePassword"),
    document.querySelector("#profileDeleteConfirmation"),
  ].forEach((control) => setCapabilityControlledDisabled(control, !canDeleteAccount, accountReason));
  setCapabilityMessage(
    document.querySelector("[data-profile-account-capability]"),
    canDeleteAccount ? "" : accountReason
  );
}

function refreshCapabilityDependentUi() {
  renderCurrentFeed();
  renderObservationList();
  updateRecognitionActions();
  renderCommunityWorkspace();
  renderProfileCenter();
  applyRuntimeCapabilityControls();
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
    bio: typeof user.bio === "string" ? user.bio : "",
    gender: typeof user.gender === "string" ? user.gender : "",
    age: user.age ?? null,
    avatarUrl: typeof user.avatarUrl === "string" ? user.avatarUrl : "",
    publicProfile: typeof user.publicProfile === "boolean" ? user.publicProfile : true,
    emailNotifications: typeof user.emailNotifications === "boolean" ? user.emailNotifications : true,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function rememberAuthUser(user) {
  const normalizedUser = normalizeAuthUser(user);
  if (!normalizedUser) return null;

  try {
    LEGACY_AUTH_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // The auth cookie is the source of truth; no user profile is stored in the browser.
  }
  currentUser = normalizedUser;
  renderUserChrome();
  return normalizedUser;
}

function clearAuthState() {
  try {
    LEGACY_AUTH_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Keep rendering even if browser storage is blocked.
  }
  currentUser = null;
  renderUserChrome();
}

function renderUserChrome() {
  const displayName = currentUser?.nickname || currentUser?.email?.split("@")[0] || "";

  userNameBadges.forEach((badge) => {
    if (!displayName) {
      badge.textContent = "";
      badge.removeAttribute("title");
      badge.removeAttribute("aria-label");
      badge.hidden = true;
      return;
    }

    badge.textContent = displayName;
    badge.title = displayName;
    badge.setAttribute("aria-label", `当前用户：${displayName}`);
    badge.hidden = false;
  });

  logoutButtons.forEach((button) => {
    button.textContent = currentUser ? "退出登录" : "登录";
    button.setAttribute("aria-label", currentUser ? "退出登录" : "登录 Birdora");
    button.hidden = !currentUser && loginLinks.length > 0;
  });

  loginLinks.forEach((link) => {
    link.hidden = Boolean(currentUser);
  });
}

function translateAuthMessage(message, fallback = "认证请求失败，请稍后重试。") {
  const messages = {
    "email and password are required": "请先填写邮箱和密码。",
    "email format is invalid": "邮箱格式不正确，请检查后重试。",
    "password must be at least 8 characters": "密码至少需要 8 位。",
    "email is already registered": "这个邮箱已经注册过了，请直接登录。",
    "email or password is incorrect": "邮箱或密码不正确，请检查后重试。",
    Unauthorized: "登录状态已失效，请重新登录。",
  };

  return messages[message] || message || fallback;
}

function withRequestId(message, error) {
  return error?.requestId ? `${message}（错误编号：${error.requestId}）` : message;
}

function createApiError(message, details = {}) {
  const error = new Error(message);
  if (details.status) error.status = details.status;
  if (details.code) error.code = details.code;
  if (details.requestId) error.requestId = details.requestId;
  if (details.cause) error.cause = details.cause;
  return error;
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
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
  try {
    response = await fetch(`${AUTH_API_BASE_URL}${path}`, {
      method,
      credentials: "include",
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw createApiError("请求超时，请检查网络后重试。", {
        code: "REQUEST_TIMEOUT",
        cause: error,
      });
    }

    throw createApiError("网络连接失败，请检查网络后重试。", {
      code: "NETWORK_ERROR",
      cause: error,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }

  const rawBody = await response.text();
  const requestId = response.headers.get("X-Request-Id") || "";
  let data = null;
  try {
    data = rawBody ? JSON.parse(rawBody) : null;
  } catch (error) {
    if (response.ok) {
      throw createApiError("认证服务返回格式异常，请稍后重试。", {
        status: response.status,
        code: "PARSE_ERROR",
        requestId,
        cause: error,
      });
    }
  }

  if (!response.ok) {
    const message = data && typeof data === "object" ? data.message : null;
    throw createApiError(translateAuthMessage(message), {
      status: response.status,
      code: data?.code || "HTTP_ERROR",
      requestId: data?.requestId || requestId,
    });
  }

  return data;
}

async function fetchAuthStatus() {
  try {
    return await authRequest(AUTH_ROUTES.status);
  } catch (error) {
    return {
      authenticated: false,
      authUnavailable: true,
      message: error.message || "认证服务暂不可用",
      user: null,
    };
  }
}

let authStateSyncPromise = null;

async function syncAuthState() {
  if (authStateSyncPromise) return authStateSyncPromise;

  authStateSyncPromise = (async () => {
    const status = await fetchAuthStatus();

    if (status.authenticated && status.user) {
      rememberAuthUser(status.user);
      return status;
    }

    if (status.authUnavailable) {
      currentUser = null;
      renderUserChrome();
      return status;
    }

    clearAuthState();
    return status;
  })();

  try {
    return await authStateSyncPromise;
  } finally {
    authStateSyncPromise = null;
  }
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

function readPostImageForUpload(file) {
  if (!file) return Promise.resolve(null);

  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowedTypes.has(file.type)) {
    return Promise.reject(new Error("配图仅支持 JPG、PNG 或 WebP。"));
  }

  if (file.size > POST_IMAGE_MAX_BYTES) {
    return Promise.reject(new Error("配图请控制在 1MB 以内。"));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        imageDataUrl: String(reader.result || ""),
        imageName: file.name || "post-image",
      });
    };
    reader.onerror = () => reject(new Error("配图读取失败，请重新选择。"));
    reader.readAsDataURL(file);
  });
}

function mergeCommunityPosts(nextPosts) {
  const postsById = new Map(communityPosts.map((post) => [post.id, post]));

  nextPosts.forEach((post) => {
    postsById.set(post.id, post);
  });

  communityPosts = Array.from(postsById.values()).sort((a, b) => {
    const aTime = new Date(a.createdAt || 0).getTime();
    const bTime = new Date(b.createdAt || 0).getTime();
    return bTime - aTime;
  });
}

async function loadCommunityPosts(options = {}) {
  const append = options.append === true;
  if (!append) {
    communityLoadState = "loading";
  }
  communityLoadMessage = "";

  try {
    const result = await communityApi.list({
      limit: COMMUNITY_PAGE_SIZE,
      offset: append ? communityPageInfo.nextOffset : 0,
    });
    if (append) {
      mergeCommunityPosts(result.posts);
    } else {
      communityPosts = result.posts;
    }
    communityPageInfo = result.pageInfo || {
      limit: COMMUNITY_PAGE_SIZE,
      offset: 0,
      nextOffset: communityPosts.length,
      hasMore: false,
    };
    userPosts = communityPosts.filter((post) => post.canManage);
    communityLoadState = "ready";
  } catch (error) {
    communityLoadState = "error";
    communityLoadMessage = withRequestId(error.message || "社区内容加载失败，请稍后重试。", error);
  }

  renderCurrentFeed();
}

function getHomePreviewPosts() {
  return communityPosts.slice(0, 3);
}

function formatPostTime(post) {
  if (!post.createdAt) return post.time || "";

  const createdAt = new Date(post.createdAt);
  if (Number.isNaN(createdAt.getTime())) return post.time || "";

  return createdAt.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatObservationTime(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getObservationMutationMessage(error, fallback) {
  if (error?.status === 401) return withRequestId("登录状态已失效，请重新登录后再保存。", error);
  if (error?.status === 403) return withRequestId("只能操作自己的观测记录。", error);
  if (error?.status === 404) return withRequestId("这条观测记录不存在或已被删除。", error);
  if (error?.status === 409) return withRequestId("这条观测记录已关联社区帖子，暂时不能删除。", error);
  return withRequestId(error?.message || fallback, error);
}

function setObservationMessage(text = "") {
  if (observationMessage) {
    observationMessage.textContent = text;
  }
}

function dataUrlByteLength(dataUrl) {
  const base64 = String(dataUrl || "").split(",")[1] || "";
  return Math.floor((base64.length * 3) / 4);
}

function canvasToDataUrlUnderLimit(canvas) {
  const qualities = [0.82, 0.72, 0.62, 0.52, 0.42];
  for (const quality of qualities) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrlByteLength(dataUrl) <= OBSERVATION_IMAGE_MAX_BYTES) {
      return dataUrl;
    }
  }

  throw new Error("压缩后的识别图片仍超过 1MB，请换一张更小的照片。");
}

function buildCompressedObservationImage(imageElement, file) {
  const width = imageElement.naturalWidth || imageElement.width;
  const height = imageElement.naturalHeight || imageElement.height;
  if (!width || !height) {
    throw new Error("无法读取识别图片尺寸。");
  }

  const scale = Math.min(1, OBSERVATION_IMAGE_MAX_DIMENSION / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(imageElement, 0, 0, canvas.width, canvas.height);

  const imageDataUrl = canvasToDataUrlUnderLimit(canvas);
  const baseName = String(file?.name || "observation-image").replace(/\.[^.]+$/, "");
  return {
    imageDataUrl,
    imageName: `${baseName || "observation-image"}.jpg`,
  };
}

function buildCandidatePayload(candidate, rank) {
  return {
    rank,
    speciesName: candidate.cn,
    scientificName: candidate.latin || "",
    englishName: candidate.en || "",
    probability: candidate.probability,
    oseaIndex: candidate.index,
    isMapped: Boolean(candidate.isMapped),
  };
}

function buildRecognitionSaveKey() {
  const candidate = selectedRecognitionCandidate;
  if (!candidate || !currentRecognitionImagePayload) return "";
  return [
    candidate.index,
    candidate.cn,
    candidate.latin || "",
    Math.round((candidate.probability || 0) * 1000000),
    currentRecognitionImagePayload.imageName || "",
  ].join("|");
}

function normalizeObservationForPost(observation) {
  return {
    title: `我记录到了一只 ${observation.selectedSpeciesName}`,
    body:
      `${observation.selectedSpeciesName}，识别置信度 ${formatCandidateScore(observation.confidence)}。` +
      "这条帖子由我的观测记录发布。",
    bird: observation.selectedSpeciesName,
    observationId: observation.id,
  };
}

function syncObservationState(nextObservation = null, removedObservationId = "") {
  if (removedObservationId) {
    observations = observations.filter((observation) => observation.id !== removedObservationId);
  } else if (nextObservation) {
    const existingIndex = observations.findIndex((observation) => observation.id === nextObservation.id);
    if (existingIndex >= 0) {
      observations.splice(existingIndex, 1, nextObservation);
    } else {
      observations.unshift(nextObservation);
    }
  }

  observations = observations.sort((a, b) => {
    const aTime = new Date(a.createdAt || 0).getTime();
    const bTime = new Date(b.createdAt || 0).getTime();
    return bTime - aTime;
  });
}

function renderObservationCard(observation) {
  const topCandidates = Array.isArray(observation.topCandidates)
    ? observation.topCandidates.slice(0, 5)
    : [];
  const topCandidateText = topCandidates.length
    ? topCandidates
        .map((candidate) => `${candidate.rank || ""}. ${candidate.speciesName} ${formatCandidateScore(candidate.probability)}`)
        .join(" / ")
    : "暂无 Top 5 快照";
  const image = observation.imageUrl
    ? `<img src="${escapeHtml(observation.imageUrl)}" alt="${escapeHtml(observation.imageAlt || observation.selectedSpeciesName)}" loading="lazy" />`
    : "";
  const detail = [observation.locationText, observation.notes].filter(Boolean).join(" · ");

  return `
    <article class="observation-card" data-observation-id="${escapeHtml(observation.id)}">
      <figure class="observation-image">${image}</figure>
      <div class="observation-content">
        <div class="observation-head">
          <div>
            <h3>${escapeHtml(observation.selectedSpeciesName)}</h3>
            <p class="observation-meta">
              ${escapeHtml(formatCandidateScore(observation.confidence))} · ${escapeHtml(formatObservationTime(observation.observedAt || observation.createdAt))}
            </p>
          </div>
        </div>
        <p class="observation-top-candidates">${escapeHtml(topCandidateText)}</p>
        ${detail ? `<p class="observation-note">${escapeHtml(detail)}</p>` : ""}
        <div class="observation-actions">
          <button class="primary-btn" type="button" data-observation-share="${escapeHtml(observation.id)}">发布到社区</button>
        </div>
      </div>
    </article>
  `;
}

function renderObservationList() {
  if (!observationList) return;

  if (!observationApi) {
    observationList.innerHTML = `
      <article class="observation-empty">
        <p>观测记录服务暂不可用，请刷新页面后重试。</p>
      </article>
    `;
    return;
  }

  if (!currentUser) {
    observationList.innerHTML = `
      <article class="observation-empty">
        <p>登录后可以查看你保存过的观测记录。</p>
        <a class="primary-btn more-link" href="${escapeHtml(getLoginUrl())}">登录</a>
      </article>
    `;
    return;
  }

  if (observationsLoadState === "loading") {
    observationList.innerHTML = `
      <article class="observation-empty" role="status">
        <p>正在加载你的观测记录...</p>
      </article>
    `;
    return;
  }

  if (observationsLoadState === "error") {
    observationList.innerHTML = `
      <article class="observation-empty">
        <p>${escapeHtml(observationsLoadMessage)}</p>
        <button class="primary-btn" type="button" data-observation-retry>重新加载</button>
      </article>
    `;
    return;
  }

  if (!observations.length) {
    observationList.innerHTML = `
      <article class="observation-empty">
        <p>暂无观测记录。</p>
      </article>
    `;
    return;
  }

  observationList.innerHTML = observations.map(renderObservationCard).join("");
  applyRuntimeCapabilityControls();
}

function updateSpeciesSummaryFromObservations() {
  const uniqueSpecies = new Set(
    observations
      .map((observation) => observation.selectedSpeciesName)
      .filter(Boolean)
  );
  const now = new Date();
  const monthSpecies = new Set(
    observations
      .filter((observation) => {
        const createdAt = new Date(observation.createdAt || observation.observedAt || 0);
        return (
          !Number.isNaN(createdAt.getTime()) &&
          createdAt.getFullYear() === now.getFullYear() &&
          createdAt.getMonth() === now.getMonth()
        );
      })
      .map((observation) => observation.selectedSpeciesName)
      .filter(Boolean)
  );

  speciesCountBadges.forEach((badge) => {
    badge.textContent = String(uniqueSpecies.size);
  });
  monthSpeciesCountBadges.forEach((badge) => {
    badge.textContent = `+${monthSpecies.size}`;
  });
}

async function loadMyObservations() {
  if (!observationList) return;

  if (!currentUser || !observationApi) {
    renderObservationList();
    return;
  }

  observationsLoadState = "loading";
  observationsLoadMessage = "";
  renderObservationList();

  try {
    const result = await observationApi.listMyObservations({
      limit: OBSERVATION_PAGE_SIZE,
      offset: 0,
    });
    observations = result.observations;
    updateSpeciesSummaryFromObservations();
    observationsPageInfo = result.pageInfo || {
      limit: OBSERVATION_PAGE_SIZE,
      offset: 0,
      nextOffset: observations.length,
      hasMore: false,
    };
    observationsLoadState = "ready";
  } catch (error) {
    observationsLoadState = "error";
    observationsLoadMessage = getObservationMutationMessage(error, "观测记录加载失败，请稍后重试。");
    if (error?.status === 401) {
      clearAuthState();
    }
  }

  renderObservationList();
  updateSpeciesSummaryFromObservations();
}

function formatInteractionTime(item) {
  if (!item.createdAt) return item.time || "";

  const createdAt = new Date(item.createdAt);
  if (Number.isNaN(createdAt.getTime())) return item.time || "";

  return createdAt.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getPostComments(post) {
  if (Array.isArray(post.commentPreview)) return post.commentPreview;
  return Array.isArray(post.comments) ? post.comments : [];
}

function getPostQuestions(post) {
  return Array.isArray(post.questions) ? post.questions : [];
}

function getPostFeedback(post) {
  return post.feedback && typeof post.feedback === "object" ? post.feedback : {};
}

function isPersistedCommunityPost(post) {
  return Boolean(post?.createdAt);
}

function formatInteractionList(items, emptyText, options = {}) {
  if (!items.length) {
    return `<p class="comment-empty">${escapeHtml(emptyText)}</p>`;
  }

  return items
    .map(
      (item) => {
        const deleteAction =
          options.canDelete && item.canManage && options.postId
            ? `<button class="comment-delete" type="button" data-comment-delete="${escapeHtml(item.id)}" data-comment-post="${escapeHtml(options.postId)}">删除</button>`
            : "";
        return `
        <li class="comment-bubble" data-comment-id="${escapeHtml(item.id || "")}">
          <p>${escapeHtml(item.body || item.text || "")}</p>
          <div class="comment-meta-row">
            <span>${escapeHtml(item.author || "社区用户")} · ${escapeHtml(formatInteractionTime(item))}</span>
            ${deleteAction}
          </div>
        </li>
      `;
      }
    )
    .join("");
}

function formatComments(post) {
  return formatInteractionList(getPostComments(post), "还没有评论，来写一句吧。", {
    postId: post.id,
    canDelete: true,
  });
}

function formatQuestions(post) {
  return formatInteractionList(getPostQuestions(post), "还没有提问。");
}

function buildObservationSummaryHtml(post) {
  const summary = post?.observationSummary;
  if (!summary) return "";

  const species = summary.selectedSpeciesName || post.bird || "已确认鸟种";
  const confidence = Number.isFinite(Number(summary.confidence))
    ? formatCandidateScore(Number(summary.confidence))
    : "";
  const observedAt = formatObservationTime(summary.observedAt || summary.createdAt);
  const details = [species, confidence, observedAt].filter(Boolean).join(" · ");

  return `
    <section class="post-observation-summary" aria-label="识别记录摘要">
      <strong>来自识别记录</strong>
      <span>${escapeHtml(details)}</span>
    </section>
  `;
}

function buildFeedCard(post, options = {}) {
  const previewMode = options.preview === true;
  const comments = getPostComments(post);
  const questions = getPostQuestions(post);
  const commentCount = Number(post.commentCount ?? comments.length) || 0;
  const questionCount = Number(post.questionCount ?? questions.length) || questions.length;
  return window.BirdoraCommunityPostCard.renderPostCard(post, {
    preview: previewMode,
    isEditing: editingPostId === post.id,
    commentsOpen: expandedComments.has(post.id),
    canInteract: isPersistedCommunityPost(post),
    canReact: isPersistedCommunityPost(post) && isCapabilityEnabled("communityLegacyLike"),
    canOpenDetails: true,
    isExample: false,
    displayBody: previewMode ? truncateText(post.body, 88) : post.body,
    author: post.author || post.bird,
    time: formatPostTime(post),
    analysis: post.analysis || null,
    feedback: getPostFeedback(post),
    commentCount,
    commentsHtml: formatComments(post),
    questionCount,
    questionsHtml: formatQuestions(post),
    observationHtml: buildObservationSummaryHtml(post),
    titleMaxLength: POST_TITLE_MAX_LENGTH,
    bodyMaxLength: POST_BODY_MAX_LENGTH,
  });
}

function renderHomeFeed() {
  if (!feed) return;
  const previewPosts = getHomePreviewPosts();
  feed.innerHTML = previewPosts.length
    ? previewPosts.map((post) => buildFeedCard(post, { preview: true })).join("")
    : `<article class="feed-card empty-feed-card"><h3>暂无社区分享</h3><p>真实观鸟笔记发布后会显示在这里。</p></article>`;
  syncHomeCommunityReveal();
}

function renderCommunityFeed() {
  if (!communityFeed) return;

  if (communityLoadState === "loading") {
    communityFeed.innerHTML = `
      <article class="feed-card empty-feed-card" role="status">
        <h3>正在加载社区内容</h3>
        <p>正在同步大家发布的观鸟笔记。</p>
      </article>
    `;
    return;
  }

  if (communityLoadState === "error") {
    communityFeed.innerHTML = `
      <article class="feed-card empty-feed-card">
        <h3>社区内容暂时无法加载</h3>
        <p>${escapeHtml(communityLoadMessage)}</p>
        <button class="primary-btn community-retry" type="button" data-community-retry>重新加载</button>
      </article>
    `;
    return;
  }

  if (activeCommunityTab === "mine" && !currentUser) {
    communityFeed.innerHTML = `
      <article class="feed-card empty-feed-card">
        <h3>登录后查看你的帖子</h3>
        <p>推荐内容可以直接浏览；登录后会显示你发布过的观鸟笔记。</p>
        <a class="primary-btn more-link" href="${escapeHtml(getLoginUrl())}">登录</a>
      </article>
    `;
    return;
  }

  const posts = activeCommunityTab === "mine" ? userPosts : communityPosts;
  if (!posts.length) {
    communityFeed.innerHTML = `
      <article class="feed-card empty-feed-card">
        <h3>${activeCommunityTab === "mine" ? "还没有你发布的帖子" : "暂无推荐帖子"}</h3>
        <p>${activeCommunityTab === "mine" ? "先回到首页发布一条观鸟笔记吧。" : "稍后再来看看新的观鸟分享。"}</p>
      </article>
    `;
    return;
  }

  const loadMore = communityPageInfo.hasMore
    ? `
      <article class="feed-card empty-feed-card load-more-card">
        <h3>还有更多观鸟笔记</h3>
        <p>继续加载下一批社区内容。</p>
        <button class="primary-btn community-retry" type="button" data-community-load-more>加载更多</button>
      </article>
    `
    : "";
  communityFeed.innerHTML = `${posts.map((post) => buildFeedCard(post)).join("")}${loadMore}`;
}

function renderCurrentFeed() {
  if (page === "community") {
    renderCommunityFeed();
  } else {
    renderHomeFeed();
  }
  applyRuntimeCapabilityControls();
}

function syncCommunityPostState(nextPost = null, removedPostId = "") {
  if (removedPostId) {
    communityPosts = communityPosts.filter((post) => post.id !== removedPostId);
    if (activeDetailPostId === removedPostId) {
      closePostDetail();
    }
  } else if (nextPost) {
    const existingIndex = communityPosts.findIndex((post) => post.id === nextPost.id);
    if (existingIndex >= 0) {
      communityPosts.splice(existingIndex, 1, nextPost);
    } else {
      communityPosts.unshift(nextPost);
    }
    if (detailPost?.id === nextPost.id) {
      detailPost = {
        ...detailPost,
        ...nextPost,
        comments: detailComments.length ? detailComments : getPostComments(nextPost),
        commentPreview: detailComments.length ? detailComments : getPostComments(nextPost),
        commentsPageInfo: detailCommentsPageInfo,
      };
    }
  }

  userPosts = communityPosts.filter((post) => post.canManage);
}

function getCommunityMutationMessage(error, fallback) {
  if (error?.status === 401) return withRequestId("登录状态已失效，请重新登录。", error);
  if (error?.status === 403) return withRequestId("你只能修改或删除自己发布的帖子。", error);
  if (error?.status === 404) return withRequestId("这条帖子已不存在，请刷新后重试。", error);
  return withRequestId(error?.message || fallback, error);
}

function getCommentMutationMessage(error, fallback) {
  if (error?.status === 401) return withRequestId("登录状态已失效，请重新登录。", error);
  if (error?.status === 403) return withRequestId("你只能删除自己发布的评论。", error);
  if (error?.status === 404) return withRequestId("这条评论已不存在，请刷新后重试。", error);
  return withRequestId(error?.message || fallback, error);
}

function startEditingPost(postId) {
  if (!isCapabilityEnabled("communityPostEdit")) {
    window.alert(getCapabilityDisabledReason("communityPostEdit"));
    return;
  }
  const post = communityPosts.find((item) => item.id === postId);
  if (!post?.canManage) return;
  editingPostId = postId;
  expandedComments.delete(postId);
  renderCurrentFeed();
  communityFeed?.querySelector(`[data-post-edit-form="${postId}"] input`)?.focus();
}

function cancelEditingPost(postId) {
  if (editingPostId !== postId) return;
  editingPostId = "";
  renderCurrentFeed();
  communityFeed?.querySelector(`[data-post-edit="${postId}"]`)?.focus();
}

async function submitPostEdit(form) {
  if (!isCapabilityEnabled("communityPostEdit")) {
    setCapabilityMessage(
      form.querySelector("[data-post-edit-message]"),
      getCapabilityDisabledReason("communityPostEdit")
    );
    return;
  }
  const postId = form.dataset.postEditForm;
  const titleField = form.elements.title;
  const bodyField = form.elements.body;
  const message = form.querySelector("[data-post-edit-message]");
  const submitButton = form.querySelector('[type="submit"]');
  const title = normalizeUserText(titleField.value, POST_TITLE_MAX_LENGTH);
  const body = normalizeUserText(bodyField.value, POST_BODY_MAX_LENGTH);

  titleField.setAttribute("aria-invalid", String(!title));
  bodyField.setAttribute("aria-invalid", String(!body));
  if (!title || !body) {
    message.textContent = title ? "请填写帖子内容。" : "请填写帖子标题。";
    (title ? bodyField : titleField).focus();
    return;
  }

  message.textContent = "正在保存...";
  submitButton.disabled = true;

  try {
    const updatedPost = await communityApi.update(postId, { title, body });
    syncCommunityPostState(updatedPost);
    editingPostId = "";
    renderCurrentFeed();
    communityFeed?.querySelector(`[data-post-edit="${postId}"]`)?.focus();
  } catch (error) {
    message.textContent = getCommunityMutationMessage(error, "保存失败，请稍后重试。");
    submitButton.disabled = false;
    if (error?.status === 401) {
      clearAuthState();
    }
  }
}

async function deleteCommunityPost(postId, button) {
  const post = communityPosts.find((item) => item.id === postId);
  if (!post?.canManage) return;
  if (!window.confirm(`确定删除《${post.title}》吗？删除后无法恢复。`)) return;

  button.disabled = true;
  button.textContent = "删除中...";

  try {
    await communityApi.remove(postId);
    syncCommunityPostState(null, postId);
    expandedComments.delete(postId);
    renderCurrentFeed();
  } catch (error) {
    button.disabled = false;
    button.textContent = "删除";
    window.alert(getCommunityMutationMessage(error, "删除失败，请稍后重试。"));
    if (error?.status === 401) {
      clearAuthState();
    }
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

function normalizeCommentsPageInfo(pageInfo = {}, comments = []) {
  const commentCount = Number(pageInfo.commentCount ?? pageInfo.total ?? comments.length) || 0;
  return {
    ...emptyCommentsPageInfo,
    ...pageInfo,
    total: commentCount,
    commentCount,
  };
}

function findCommunityPost(postId) {
  return communityPosts.find((post) => post.id === postId) || null;
}

function getPostDetailBackdrop() {
  let backdrop = document.querySelector("[data-post-detail-backdrop]");
  if (backdrop) return backdrop;

  backdrop = document.createElement("div");
  backdrop.className = "post-detail-backdrop is-hidden";
  backdrop.dataset.postDetailBackdrop = "true";
  document.body.appendChild(backdrop);
  return backdrop;
}

function closePostDetail() {
  activeDetailPostId = "";
  detailPost = null;
  detailComments = [];
  detailCommentsPageInfo = { ...emptyCommentsPageInfo };
  detailLoadState = "idle";
  detailLoadMessage = "";
  const backdrop = getPostDetailBackdrop();
  backdrop.classList.add("is-hidden");
  backdrop.innerHTML = "";
  document.body.classList.remove("has-modal-open");
}

function renderPostDetail() {
  const backdrop = getPostDetailBackdrop();
  if (!activeDetailPostId) {
    closePostDetail();
    return;
  }

  const post = detailPost || findCommunityPost(activeDetailPostId);
  const canInteract = Boolean(post && isPersistedCommunityPost(post));
  const loadingOnly = detailLoadState === "loading" && !post;
  const image = post?.imageUrl
    ? `
      <figure class="post-image-frame post-detail-image">
        <img src="${escapeHtml(post.imageUrl)}" alt="${escapeHtml(post.imageAlt || post.title)}" />
      </figure>
    `
    : "";
  const commentForm = canInteract
    ? `
      <div class="comment-form detail-comment-form">
        <input
          class="comment-input"
          type="text"
          maxlength="${COMMENT_MAX_LENGTH}"
          placeholder="写下你的观察或想法..."
          aria-label="写下你的观察或想法"
          data-detail-comment-input="${escapeHtml(post.id)}"
        />
        <button class="comment-send" type="button" data-detail-comment-submit="${escapeHtml(post.id)}">发送</button>
      </div>
    `
    : `<p class="comment-empty">登录后可以参与评论。</p>`;
  const commentsHtml = formatInteractionList(detailComments, "还没有评论，来写一句吧。", {
    postId: post?.id || "",
    canDelete: true,
  });
  const loadMoreComments = detailCommentsPageInfo.hasMore
    ? `<button class="comment-load-more" type="button" data-detail-comments-load-more="${escapeHtml(post?.id || "")}">加载更多评论</button>`
    : "";
  const statusMessage =
    detailLoadState === "loading"
      ? `<p class="post-detail-message" role="status">正在加载详情...</p>`
      : detailLoadState === "error"
        ? `
          <p class="post-detail-message is-error">${escapeHtml(detailLoadMessage || "帖子详情加载失败。")}</p>
          <button class="post-action" type="button" data-post-detail-retry="${escapeHtml(activeDetailPostId)}">重新加载</button>
        `
        : "";
  const body = loadingOnly || !post
    ? statusMessage || `<p class="post-detail-message is-error">帖子详情暂时不可用。</p>`
    : `
      <article class="post-detail-card" data-post-detail-card="${escapeHtml(post.id)}">
        <header class="post-detail-head">
          <div>
            <div class="feed-meta"><span>${escapeHtml(post.author || post.bird || "Birdora")}</span><span>${escapeHtml(formatPostTime(post))}</span></div>
            <h2 id="postDetailTitle">${escapeHtml(post.title)}</h2>
          </div>
          <button class="post-detail-close" type="button" aria-label="关闭帖子详情" data-post-detail-close>关闭</button>
        </header>
        ${image}
        <p class="post-detail-body">${escapeHtml(post.body)}</p>
        ${buildObservationSummaryHtml(post)}
        ${statusMessage}
        <section class="post-detail-comments" aria-label="评论">
          <div class="comment-toolbar">
            <strong>评论 ${Number(detailCommentsPageInfo.commentCount ?? post.commentCount ?? detailComments.length) || 0}</strong>
          </div>
          ${commentForm}
          <ul class="comment-list">${commentsHtml}</ul>
          ${loadMoreComments}
        </section>
      </article>
    `;

  backdrop.classList.remove("is-hidden");
  document.body.classList.add("has-modal-open");
  backdrop.innerHTML = `
    <div class="post-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="postDetailTitle">
      ${body}
    </div>
  `;
}

async function openPostDetail(postId) {
  const localPost = findCommunityPost(postId);
  activeDetailPostId = postId;
  detailPost = localPost;
  detailComments = getPostComments(localPost || {});
  detailCommentsPageInfo = normalizeCommentsPageInfo(localPost?.commentsPageInfo, detailComments);
  detailLoadState = "loading";
  detailLoadMessage = "";
  renderPostDetail();

  try {
    const post = await communityApi.get(postId, { limit: COMMENT_PAGE_SIZE, offset: 0 });
    if (activeDetailPostId !== postId) return;
    detailPost = post;
    detailComments = Array.isArray(post.comments) ? post.comments : [];
    detailCommentsPageInfo = normalizeCommentsPageInfo(post.commentsPageInfo, detailComments);
    detailLoadState = "ready";
    syncCommunityPostState(post);
  } catch (error) {
    if (activeDetailPostId !== postId) return;
    detailLoadState = "error";
    detailLoadMessage = withRequestId(error.message || "帖子详情加载失败，请稍后重试。", error);
    if (error?.status === 401) {
      clearAuthState();
    }
  }

  renderCurrentFeed();
  renderPostDetail();
  window.setTimeout(() => {
    document.querySelector("[data-post-detail-close]")?.focus();
  }, 0);
}

async function loadDetailComments(options = {}) {
  if (!detailPost) return;
  const append = options.append === true;
  const offset = append ? detailCommentsPageInfo.nextOffset : 0;
  detailLoadState = "loading";
  detailLoadMessage = "";
  renderPostDetail();

  try {
    const result = await communityApi.listComments(detailPost.id, {
      limit: COMMENT_PAGE_SIZE,
      offset,
    });
    const nextComments = Array.isArray(result.comments) ? result.comments : [];
    if (append) {
      const commentsById = new Map(detailComments.map((comment) => [comment.id, comment]));
      nextComments.forEach((comment) => commentsById.set(comment.id, comment));
      detailComments = Array.from(commentsById.values());
    } else {
      detailComments = nextComments;
    }
    detailCommentsPageInfo = normalizeCommentsPageInfo(result.pageInfo, detailComments);
    detailPost = {
      ...detailPost,
      comments: detailComments,
      commentPreview: detailComments,
      commentCount: detailCommentsPageInfo.commentCount,
      commentsPageInfo: detailCommentsPageInfo,
    };
    syncCommunityPostState(detailPost);
    detailLoadState = "ready";
  } catch (error) {
    detailLoadState = "error";
    detailLoadMessage = getCommentMutationMessage(error, "评论加载失败，请稍后重试。");
    if (error?.status === 401) {
      clearAuthState();
    }
  }

  renderCurrentFeed();
  renderPostDetail();
}

async function submitDetailComment(postId, trigger = null) {
  if (!requireLoginForAction()) return;
  const field = document.querySelector(`[data-detail-comment-input="${postId}"]`);
  if (!field) return;

  const text = normalizeUserText(field.value, COMMENT_MAX_LENGTH);
  if (!text) {
    field.setAttribute("aria-invalid", "true");
    field.focus();
    return;
  }

  field.disabled = true;
  if (trigger) trigger.disabled = true;

  try {
    const updatedPost = await communityApi.comment(postId, text);
    syncCommunityPostState(updatedPost);
    await loadDetailComments({ append: false });
    const hasNewComment = detailComments.some((comment) => comment.body === text && comment.canManage);
    if (!hasNewComment) {
      const newComment = getPostComments(updatedPost)
        .slice()
        .reverse()
        .find((comment) => comment.body === text && comment.canManage);
      if (newComment) {
        detailComments = [...detailComments, newComment];
        detailCommentsPageInfo = normalizeCommentsPageInfo(
          {
            ...detailCommentsPageInfo,
            nextOffset: detailComments.length,
            hasMore: false,
          },
          detailComments
        );
      }
    }
    detailPost = {
      ...(detailPost || updatedPost),
      ...updatedPost,
      comments: detailComments,
      commentPreview: detailComments,
      commentsPageInfo: detailCommentsPageInfo,
    };
    renderCurrentFeed();
    renderPostDetail();
  } catch (error) {
    field.disabled = false;
    if (trigger) trigger.disabled = false;
    window.alert(getCommentMutationMessage(error, "评论失败，请稍后重试。"));
    if (error?.status === 401) {
      clearAuthState();
    }
  }
}

async function deleteCommunityComment(postId, commentId, button = null) {
  if (!requireLoginForAction()) return;
  if (!window.confirm("确定删除这条评论吗？")) return;

  if (button) {
    button.disabled = true;
    button.textContent = "删除中...";
  }

  try {
    await communityApi.deleteComment(postId, commentId);
    if (detailPost?.id === postId) {
      detailComments = detailComments.filter((comment) => comment.id !== commentId);
      const nextCount = Math.max(0, (Number(detailCommentsPageInfo.commentCount) || detailComments.length + 1) - 1);
      detailCommentsPageInfo = {
        ...detailCommentsPageInfo,
        total: nextCount,
        commentCount: nextCount,
        nextOffset: Math.min(detailCommentsPageInfo.nextOffset, detailComments.length),
        hasMore: detailCommentsPageInfo.hasMore && detailComments.length < nextCount,
      };
      detailPost = {
        ...detailPost,
        comments: detailComments,
        commentPreview: detailComments,
        commentCount: nextCount,
        commentsPageInfo: detailCommentsPageInfo,
      };
    }

    const existingPost = communityPosts.find((post) => post.id === postId);
    if (existingPost) {
      const nextComments = getPostComments(existingPost).filter((comment) => comment.id !== commentId);
      const nextCount = Math.max(0, (Number(existingPost.commentCount) || getPostComments(existingPost).length) - 1);
      syncCommunityPostState({
        ...existingPost,
        comments: nextComments,
        commentPreview: nextComments,
        commentCount: nextCount,
        commentsPageInfo: normalizeCommentsPageInfo(
          {
            ...existingPost.commentsPageInfo,
            nextOffset: nextComments.length,
            hasMore: nextCount > nextComments.length,
            total: nextCount,
            commentCount: nextCount,
          },
          nextComments
        ),
      });
    }

    renderCurrentFeed();
    renderPostDetail();
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = "删除";
    }
    window.alert(getCommentMutationMessage(error, "删除评论失败，请稍后重试。"));
    if (error?.status === 401) {
      clearAuthState();
    }
  }
}

async function submitComment(postId, trigger = null) {
  if (!requireLoginForAction()) return;

  const currentFeed = page === "community" ? communityFeed : feed;
  const field = currentFeed?.querySelector(`[data-comment-input="${postId}"]`);
  if (!field) return;

  const text = normalizeUserText(field.value, COMMENT_MAX_LENGTH);
  if (!text) {
    field.setAttribute("aria-invalid", "true");
    field.focus();
    return;
  }

  field.disabled = true;
  if (trigger) trigger.disabled = true;

  try {
    const updatedPost = await communityApi.comment(postId, text);
    syncCommunityPostState(updatedPost);
    expandedComments.add(postId);
    renderCurrentFeed();
  } catch (error) {
    field.disabled = false;
    if (trigger) trigger.disabled = false;
    window.alert(getCommunityMutationMessage(error, "评论失败，请稍后重试。"));
    if (error?.status === 401) {
      clearAuthState();
    }
  }
}

async function submitQuestion(postId, trigger = null) {
  if (!requireLoginForAction()) return;

  const currentFeed = page === "community" ? communityFeed : feed;
  const field = currentFeed?.querySelector(`[data-question-input="${postId}"]`);
  if (!field) return;

  const text = normalizeUserText(field.value, QUESTION_MAX_LENGTH);
  if (!text) {
    field.setAttribute("aria-invalid", "true");
    field.focus();
    return;
  }

  field.disabled = true;
  if (trigger) trigger.disabled = true;

  try {
    const updatedPost = await communityApi.question(postId, text);
    syncCommunityPostState(updatedPost);
    expandedComments.add(postId);
    renderCurrentFeed();
  } catch (error) {
    field.disabled = false;
    if (trigger) trigger.disabled = false;
    window.alert(getCommunityMutationMessage(error, "提问失败，请稍后重试。"));
    if (error?.status === 401) {
      clearAuthState();
    }
  }
}

async function togglePostReaction(postId, reactionType, trigger = null) {
  if (!isCapabilityEnabled("communityLegacyLike")) {
    applyRuntimeCapabilityControls();
    return;
  }
  if (!requireLoginForAction()) return;

  if (trigger) trigger.disabled = true;

  try {
    const updatedPost = await communityApi.react(postId, reactionType);
    syncCommunityPostState(updatedPost);
    renderCurrentFeed();
  } catch (error) {
    if (trigger) trigger.disabled = false;
    window.alert(getCommunityMutationMessage(error, "评价失败，请稍后重试。"));
    if (error?.status === 401) {
      clearAuthState();
    }
  }
}

function bindCommentFeed(root) {
  if (!root) return;

  root.addEventListener("click", (event) => {
    const retryButton = event.target.closest("[data-community-retry]");
    if (retryButton) {
      loadCommunityPosts();
      return;
    }

    const loadMoreButton = event.target.closest("[data-community-load-more]");
    if (loadMoreButton) {
      loadMoreButton.disabled = true;
      loadMoreButton.textContent = "加载中...";
      loadCommunityPosts({ append: true });
      return;
    }

    const detailButton = event.target.closest("[data-post-detail]");
    if (detailButton) {
      openPostDetail(detailButton.dataset.postDetail);
      return;
    }

    const editButton = event.target.closest("[data-post-edit]");
    if (editButton) {
      startEditingPost(editButton.dataset.postEdit);
      return;
    }

    const cancelEditButton = event.target.closest("[data-post-edit-cancel]");
    if (cancelEditButton) {
      cancelEditingPost(cancelEditButton.dataset.postEditCancel);
      return;
    }

    const deleteButton = event.target.closest("[data-post-delete]");
    if (deleteButton) {
      deleteCommunityPost(deleteButton.dataset.postDelete, deleteButton);
      return;
    }

    const reactionButton = event.target.closest("[data-post-reaction]");
    if (reactionButton) {
      togglePostReaction(
        reactionButton.dataset.postReaction,
        reactionButton.dataset.reactionType,
        reactionButton
      );
      return;
    }

    const toggleButton = event.target.closest("[data-comment-toggle]");
    if (toggleButton) {
      toggleComments(toggleButton.dataset.commentToggle);
      return;
    }

    const submitButton = event.target.closest("[data-comment-submit]");
    if (submitButton) {
      submitComment(submitButton.dataset.commentSubmit, submitButton);
      return;
    }

    const submitQuestionButton = event.target.closest("[data-question-submit]");
    if (submitQuestionButton) {
      submitQuestion(submitQuestionButton.dataset.questionSubmit, submitQuestionButton);
    }
  });

  root.addEventListener("submit", (event) => {
    const editForm = event.target.closest("[data-post-edit-form]");
    if (!editForm) return;
    event.preventDefault();
    submitPostEdit(editForm);
  });

  root.addEventListener("keydown", (event) => {
    const input = event.target.closest("[data-comment-input]");
    const questionInput = event.target.closest("[data-question-input]");
    if ((!input && !questionInput) || event.key !== "Enter") return;
    event.preventDefault();
    if (input) {
      submitComment(input.dataset.commentInput);
    } else {
      submitQuestion(questionInput.dataset.questionInput);
    }
  });

  root.addEventListener("input", (event) => {
    const input = event.target.closest("[data-comment-input], [data-question-input]");
    if (!input) return;
    input.setAttribute("aria-invalid", "false");
  });
}

function initPostDetailDialog() {
  if (detailDialogBound) return;
  detailDialogBound = true;

  document.addEventListener("click", (event) => {
    const closeButton = event.target.closest("[data-post-detail-close]");
    if (closeButton || event.target.matches("[data-post-detail-backdrop]")) {
      closePostDetail();
      return;
    }

    const retryButton = event.target.closest("[data-post-detail-retry]");
    if (retryButton) {
      openPostDetail(retryButton.dataset.postDetailRetry);
      return;
    }

    const loadMoreButton = event.target.closest("[data-detail-comments-load-more]");
    if (loadMoreButton) {
      loadMoreButton.disabled = true;
      loadMoreButton.textContent = "加载中...";
      loadDetailComments({ append: true });
      return;
    }

    const detailCommentSubmit = event.target.closest("[data-detail-comment-submit]");
    if (detailCommentSubmit) {
      submitDetailComment(detailCommentSubmit.dataset.detailCommentSubmit, detailCommentSubmit);
      return;
    }

    const commentDeleteButton = event.target.closest("[data-comment-delete]");
    if (commentDeleteButton) {
      deleteCommunityComment(
        commentDeleteButton.dataset.commentPost,
        commentDeleteButton.dataset.commentDelete,
        commentDeleteButton
      );
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeDetailPostId) {
      closePostDetail();
      return;
    }

    const detailInput = event.target.closest("[data-detail-comment-input]");
    if (!detailInput || event.key !== "Enter") return;
    event.preventDefault();
    submitDetailComment(detailInput.dataset.detailCommentInput);
  });

  document.addEventListener("input", (event) => {
    const detailInput = event.target.closest("[data-detail-comment-input]");
    if (!detailInput) return;
    detailInput.setAttribute("aria-invalid", "false");
  });
}

function syncCommunityTabs() {
  if (!communityTabs.length) return;

  try {
    activeCommunityTab = window.localStorage.getItem(STORAGE_KEYS.communityTab) || "recommended";
  } catch {
    activeCommunityTab = "recommended";
  }

  if (![...communityTabs].some((tab) => tab.dataset.communityTab === activeCommunityTab)) {
    activeCommunityTab = "recommended";
  }

  communityTabs.forEach((tab) => {
    const active = tab.dataset.communityTab === activeCommunityTab;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });

  if (communityFeed) {
    const activeTab = Array.from(communityTabs).find((tab) => tab.dataset.communityTab === activeCommunityTab);
    if (activeTab?.id) {
      communityFeed.setAttribute("aria-labelledby", activeTab.id);
    }
  }
}

function initCommunityTabs() {
  if (!communityTabs.length) return;

  syncCommunityTabs();

  if (communityTabsBound) return;
  communityTabsBound = true;

  communityTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activeCommunityTab = tab.dataset.communityTab;
      try {
        window.localStorage.setItem(STORAGE_KEYS.communityTab, activeCommunityTab);
      } catch {
        // The selected tab can remain in memory for this visit.
      }
      syncCommunityTabs();
      renderCommunityFeed();
    });

    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;

      event.preventDefault();
      const tabs = Array.from(communityTabs);
      const currentIndex = tabs.indexOf(tab);
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      const nextTab = tabs[nextIndex];
      if (!nextTab) return;

      activeCommunityTab = nextTab.dataset.communityTab;
      try {
        window.localStorage.setItem(STORAGE_KEYS.communityTab, activeCommunityTab);
      } catch {
        // The selected tab can remain in memory for this visit.
      }
      syncCommunityTabs();
      renderCommunityFeed();
      nextTab.focus();
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
        window.location.replace(getPostLoginUrl());
      } catch (error) {
        setMessage(withRequestId(error.message || "注册失败，请稍后重试。", error));
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
      window.location.replace(getPostLoginUrl());
    } catch (error) {
      setMessage(withRequestId(error.message || "登录失败，请稍后重试。", error));
    } finally {
      setSubmitting(false);
    }
  });

  setAuthMode(form.dataset.authMode || "login");
  window.__birdoraAuthFormsReady = true;
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
    button.addEventListener("click", () => {
      if (!currentUser) {
        window.location.href = getLoginUrl();
        return;
      }

      logout();
    });
  });

  if (logoutButtons.length) {
    window.__birdoraLogoutReady = true;
  }
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId = 0;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    window.clearTimeout(timeoutId);
  });
}

function fetchJsonWithTimeout(url, timeoutMs, message) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return fetch(url, { signal: controller.signal }).finally(() => {
    window.clearTimeout(timeoutId);
  }).catch((error) => {
    if (error.name === "AbortError") {
      throw new Error(message);
    }

    throw error;
  });
}

function createRecognitionError(kind, message, details = {}) {
  const error = new Error(message);
  error.recognitionKind = kind;
  if (details.status) error.status = details.status;
  if (details.code) error.code = details.code;
  if (details.requestId) error.requestId = details.requestId;
  if (details.cause) error.cause = details.cause;
  return error;
}

function isIosDevice() {
  return /iPad|iPhone|iPod/i.test(navigator.userAgent || "");
}

function isWeChatBrowser() {
  return /MicroMessenger/i.test(navigator.userAgent || "");
}

function shouldUseServerRecognitionFirst() {
  return (
    window.BIRDORA_FORCE_SERVER_RECOGNITION === true ||
    String(window.BIRDORA_FORCE_SERVER_RECOGNITION || "").toLowerCase() === "true" ||
    (isIosDevice() && isWeChatBrowser())
  );
}

function isRecognizableImageFile(file) {
  const name = String(file?.name || "").toLowerCase();
  return (
    String(file?.type || "").startsWith("image/") ||
    /\.(jpe?g|png|webp|heic|heif)$/i.test(name)
  );
}

function isHeicMetadata(file) {
  const type = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  return type === "image/heic" || type === "image/heif" || /\.(heic|heif)$/i.test(name);
}

function readBlobAsArrayBuffer(blob) {
  if (blob.arrayBuffer) return blob.arrayBuffer();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("图片文件头读取失败。"));
    reader.readAsArrayBuffer(blob);
  });
}

function isHeicHeader(bytes) {
  if (!bytes || bytes.length < 12) return false;
  const header = String.fromCharCode(...bytes.slice(4, Math.min(bytes.length, 32)));
  return (
    header.startsWith("ftyp") &&
    /(heic|heix|hevc|hevx|heim|heis|mif1|msf1)/i.test(header)
  );
}

async function isHeicFile(file) {
  if (isHeicMetadata(file)) return true;

  try {
    const buffer = await readBlobAsArrayBuffer(file.slice(0, 32));
    return isHeicHeader(new Uint8Array(buffer));
  } catch {
    return false;
  }
}

function loadHeicConverter() {
  if (window.HeicTo) return Promise.resolve(window.HeicTo);
  if (heicConverterPromise) return heicConverterPromise;

  heicConverterPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = HEIC_CONVERTER_PATH;
    script.async = true;
    script.onload = () => {
      if (window.HeicTo) {
        resolve(window.HeicTo);
      } else {
        reject(new Error("HEIC 转换器加载后没有初始化。"));
      }
    };
    script.onerror = () => reject(new Error("HEIC 转换器加载失败。"));
    document.head.appendChild(script);
  }).catch((error) => {
    heicConverterPromise = null;
    throw error;
  });

  return heicConverterPromise;
}

function makeConvertedImageFile(blob, originalFile) {
  const baseName = String(originalFile?.name || "iphone-photo").replace(/\.[^.]+$/, "") || "iphone-photo";
  const fileName = `${baseName}.jpg`;

  try {
    return new File([blob], fileName, {
      type: "image/jpeg",
      lastModified: originalFile?.lastModified || Date.now(),
    });
  } catch {
    blob.name = fileName;
    return blob;
  }
}

async function prepareRecognitionImageFile(file, onStatus) {
  if (!isRecognizableImageFile(file)) {
    throw createRecognitionError("image-read", "请选择 JPG、PNG、WebP 或 iPhone HEIC/HEIF 照片。");
  }

  if (!(await isHeicFile(file))) {
    return file;
  }

  onStatus("正在转换 iPhone HEIC 照片为网页可识别的 JPEG...");
  try {
    const heicTo = await loadHeicConverter();
    const converted = await heicTo({
      blob: file,
      type: "image/jpeg",
      quality: 0.86,
    });
    const convertedBlob = Array.isArray(converted) ? converted[0] : converted;
    if (!convertedBlob?.size) {
      throw new Error("HEIC 转换结果为空。");
    }
    return makeConvertedImageFile(convertedBlob, file);
  } catch (error) {
    throw createRecognitionError(
      "heic-conversion",
      "iPhone 高效率照片转换失败，请换一张截图或 JPG 照片后重试。",
      { cause: error }
    );
  }
}

function loadPreviewImage(file) {
  let objectUrl = "";

  return new Promise((resolve, reject) => {
    objectUrl = URL.createObjectURL(file);
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      preview.onload = null;
      preview.onerror = null;
      reject(createRecognitionError("image-read", "图片读取超时，请换一张截图或 JPG 照片后重试。"));
    }, RECOGNITION_IMAGE_LOAD_TIMEOUT_MS);

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      preview.onload = null;
      preview.onerror = null;
      fn();
    };

    preview.onload = () => finish(resolve);
    preview.onerror = () => finish(() => {
      reject(createRecognitionError("image-read", "图片读取失败，请换一张截图或 JPG/PNG 照片后重试。"));
    });
    preview.src = objectUrl;
  }).finally(() => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });
}

async function recognitionRequest(body) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), RECOGNITION_SERVER_TIMEOUT_MS);

  try {
    const response = await fetch(`${AUTH_API_BASE_URL}/api/recognition/classify`, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const rawBody = await response.text();
    const requestId = response.headers.get("X-Request-Id") || "";
    let data = null;

    try {
      data = rawBody ? JSON.parse(rawBody) : null;
    } catch (error) {
      throw createRecognitionError("server", "识别服务返回格式异常，请稍后重试。", {
        status: response.status,
        requestId,
        cause: error,
      });
    }

    if (!response.ok) {
      const message = data && typeof data === "object" ? data.message : "";
      const translated =
        response.status === 401
          ? "登录状态已失效，请重新登录后再识别。"
          : response.status === 429
            ? "识别请求太频繁，请稍等后重试。"
            : message || "识别服务暂时不可用，请稍后重试。";
      throw createRecognitionError("server", translated, {
        status: response.status,
        code: data?.code || "HTTP_ERROR",
        requestId: data?.requestId || requestId,
      });
    }

    return data;
  } catch (error) {
    if (error?.recognitionKind) throw error;
    if (error?.name === "AbortError") {
      throw createRecognitionError("server", "识别服务响应超时，请检查网络后重试。", { cause: error });
    }
    throw createRecognitionError("server", "识别服务连接失败，请检查网络后重试。", { cause: error });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function enrichRecognitionResult(result) {
  const candidates = Array.isArray(result?.candidates)
    ? result.candidates.map((candidate) => ({
        ...candidate,
        atlasBird: candidate.isMapped ? findAtlasBirdForCandidate(candidate) : null,
      }))
    : [];

  return {
    ...result,
    candidates,
    top: candidates[0] || null,
    isConfident: Boolean(candidates[0] && candidates[0].isMapped && candidates[0].probability >= OSEA_CONFIDENCE_THRESHOLD),
    source: result?.source || "osea-server",
  };
}

async function classifyImageWithServer(imagePayload, onStatus) {
  if (!imagePayload?.imageDataUrl) {
    throw createRecognitionError("server", "没有可发送给兼容识别服务的图片。");
  }

  onStatus("正在使用兼容识别服务分析照片...");
  const data = await recognitionRequest({
    imageDataUrl: imagePayload.imageDataUrl,
    imageName: imagePayload.imageName || "recognition-image.jpg",
  });

  if (!data?.result) {
    throw createRecognitionError("server", "识别服务没有返回有效结果。");
  }

  return enrichRecognitionResult(data.result);
}

async function classifyImageWithFallback(imageElement, imagePayload, onStatus) {
  if (shouldUseServerRecognitionFirst()) {
    onStatus("检测到 iPhone 微信环境，正在切换到兼容识别服务...");
    return classifyImageWithServer(imagePayload, onStatus);
  }

  try {
    const result = await classifyImageElement(imageElement, onStatus);
    return {
      ...result,
      source: "osea-browser",
    };
  } catch (browserError) {
    onStatus("本机模型运行不稳定，正在切换到兼容识别服务...");
    try {
      return await classifyImageWithServer(imagePayload, onStatus);
    } catch (serverError) {
      if (!serverError.cause) serverError.cause = browserError;
      throw serverError;
    }
  }
}

function getClassifier(onStatus = () => {}) {
  if (!classifierPromise) {
    if (!window.ort) {
      classifierPromise = Promise.reject(
        new Error("ONNX Runtime 没有加载完成，请确认 assets/vendor/ort.min.js 存在。")
      ).catch((error) => {
        classifierPromise = null;
        throw error;
      });
    } else {
      onStatus("正在准备 OSEA 模型运行器...");
      window.ort.env.wasm.numThreads = 1;
      window.ort.env.wasm.wasmPaths = new URL("./assets/vendor/", window.location.href).href;
      classifierPromise = withTimeout(
        window.ort.InferenceSession.create(OSEA_MODEL_PATH, {
          executionProviders: ["wasm"],
        }),
        OSEA_MODEL_LOAD_TIMEOUT_MS,
        "OSEA 模型加载超时，请检查网络后重新选择照片。"
      ).catch((error) => {
        classifierPromise = null;
        throw error;
      });
    }
  } else {
    onStatus("正在等待 OSEA 模型加载完成...");
  }
  return classifierPromise;
}

function getBirdInfo(onStatus = () => {}) {
  if (!birdInfoPromise) {
    onStatus("正在加载 OSEA 鸟类标签库...");
    birdInfoPromise = fetchJsonWithTimeout(
      OSEA_LABELS_PATH,
      OSEA_LABEL_LOAD_TIMEOUT_MS,
      "鸟类标签库加载超时，请检查网络后重试。"
    )
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
      })
      .catch((error) => {
        birdInfoPromise = null;
        throw error;
      });
  } else {
    onStatus("正在读取已缓存的鸟类标签库...");
  }

  return birdInfoPromise;
}

function updateModelReadiness() {
  if (!resultMeta || !modelDetail) return;

  window.setTimeout(() => {
    if (lastRecognitionStatus !== "idle") return;

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
  const isMapped = Boolean(cn || en || latin);

  return {
    index,
    cn: cn || `未映射 OSEA 输出标签 ${index + 1}`,
    en: en || "",
    latin: latin || "",
    isMapped,
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
  const length = logits.length;
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
      atlasBird: candidate.isMapped ? findAtlasBirdForCandidate(candidate) : null,
    };
  });
}

async function classifyImageElement(imageElement, onStatus = () => {}) {
  onStatus("正在加载 OSEA 模型和鸟类标签库，首次使用可能需要更久...");
  const [classifier, birdInfo] = await Promise.all([
    getClassifier(onStatus),
    getBirdInfo(onStatus),
  ]);

  onStatus("正在把照片转换为模型输入...");
  const tensor = imageToOseaTensor(imageElement);
  const feeds = { [classifier.inputNames[0]]: tensor };

  onStatus("正在运行 OSEA 鸟类识别模型...");
  const outputMap = await classifier.run(feeds);
  const output = outputMap[classifier.outputNames[0]];

  onStatus("正在整理 Top 5 识别候选...");
  const candidates = topOseaCandidates(output.data, birdInfo);
  const top = candidates[0] || null;

  return {
    candidates,
    outputCount: output.data.length,
    labelCount: birdInfo.length,
    unmappedOutputCount: Math.max(0, output.data.length - birdInfo.length),
    top,
    isConfident: Boolean(top && top.isMapped && top.probability >= OSEA_CONFIDENCE_THRESHOLD),
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
    atlasEntriesPromise = Promise.all([getBirdInfo(), getBirdProfiles()])
      .then(([labels]) => buildAtlasEntries(labels))
      .catch((error) => {
        atlasEntriesPromise = null;
        throw error;
      });
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

  atlasSummary.textContent = `已索引 ${total.toLocaleString("zh-CN")} 个 OSEA 标签；默认优先展示常见候选清单里的鸟种。${progressNote}${sourceNote}`;
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

function renderAtlasCard(entry, options = {}) {
  const isRich = entry.detailLevel === "rich";
  const hasImage = Boolean(isRich && entry.image);
  const duplicateTabIndex = options.duplicate ? ' tabindex="-1"' : "";
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
    ? `<a class="source-link" href="${escapeHtml(entry.source)}" target="_blank" rel="noreferrer"${duplicateTabIndex}>查看来源</a>`
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
          <button class="source-link atlas-open" type="button" data-atlas-index="${entry.index}"${duplicateTabIndex}>查看详情</button>
        </div>
      </div>
    </article>
  `;
}

function renderAtlasDetail(entry, context = "图鉴详情") {
  if (!atlasDetail || !entry) return;

  atlasDetail.hidden = false;
  const hasImage = Boolean(entry.image);
  const imageRights = entry.image
    ? `${entry.imageCredit || "图片来源待补充"}${entry.license ? ` · ${entry.license}` : ""}`
    : "图片待补充";
  const sourceMarkup = entry.source
    ? `<a href="${escapeHtml(entry.source)}" target="_blank" rel="noreferrer">查看图片/资料来源</a>`
    : `<span>资料来源：OSEA 标签库，百科资料待补充</span>`;
  const photoMarkup = hasImage
    ? `
      <figure class="atlas-detail-photo">
        <img src="${escapeHtml(entry.image)}" alt="${escapeHtml(entry.name)}照片" loading="eager" />
        <figcaption>${escapeHtml(imageRights)}</figcaption>
      </figure>
    `
    : `
      <figure class="atlas-detail-photo bird-placeholder" aria-label="${escapeHtml(entry.name)}待补充图片">
        <span>${escapeHtml(entry.cn.slice(0, 1))}</span>
        <figcaption>图片待补充</figcaption>
      </figure>
    `;

  selectedAtlasIndex = entry.index;
  atlasDetail.innerHTML = `
    <div class="atlas-detail-main">
      ${photoMarkup}
      <div class="atlas-detail-heading">
        <p class="eyebrow">${escapeHtml(context)}</p>
        <h3>${escapeHtml(entry.name)}</h3>
        <p>${escapeHtml(entry.en || "英文名待补充")} · ${escapeHtml(entry.latin || "拉丁名待补充")}</p>
      </div>
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

  const runId = ++atlasRenderRunId;
  const query = birdSearch.value.trim().toLowerCase();
  const isSearching = Boolean(query);
  birdGrid.hidden = isSearching;
  if (isSearching) {
    stopAtlasMarqueeAutoScroll();
    birdGrid.innerHTML = "";
  }
  if (atlasDetail) {
    if (isSearching) {
      atlasDetail.hidden = false;
      atlasDetail.innerHTML = `<div class="atlas-detail-heading"><p class="eyebrow">搜索中</p><h3>正在匹配鸟种</h3><p>正在从中文名、英文名和拉丁名中查找相关线索。</p></div>`;
    } else {
      atlasDetail.hidden = true;
      atlasDetail.innerHTML = "";
    }
  }
  birdGrid.classList.remove("is-empty");
  birdGrid.classList.remove("is-marquee");
  if (!isSearching) {
    birdGrid.innerHTML = `<article class="bird-card atlas-loading"><div><h3>正在加载图鉴索引</h3><p>正在读取 OSEA 鸟类标签库...</p></div></article>`;
  }

  try {
    const [entries, commonBirdCandidates] = await Promise.all([
      getAtlasEntries(),
      getCommonBirdCandidates(),
    ]);
    if (runId !== atlasRenderRunId) return;

    const matched = query
      ? entries.filter((entry) => entry.searchText.includes(query))
      : entries;
    const initialLimit = getAtlasInitialLimit();
    const entryByIndex = new Map(entries.map((entry) => [entry.index, entry]));
    const candidateEntries = commonBirdCandidates
      .map((candidate) => entryByIndex.get(candidate.oseaIndex))
      .filter(Boolean);
    const defaultCandidateEntries = candidateEntries.filter(
      (entry) => !ATLAS_DEFAULT_HIDDEN_INDEXES.has(entry.index)
    );
    const candidateEntryIndexSet = new Set(candidateEntries.map((entry) => entry.index));
    const fallbackEntries = entries.filter(
      (entry) =>
        !candidateEntryIndexSet.has(entry.index) &&
        !ATLAS_DEFAULT_HIDDEN_INDEXES.has(entry.index)
    );
    const visible = query
      ? matched.slice(0, getAtlasSearchLimit())
      : [...defaultCandidateEntries, ...fallbackEntries].slice(0, initialLimit);
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

    if (!query && atlasDetail && !options.keepDetail) {
      atlasDetail.hidden = true;
      atlasDetail.innerHTML = "";
    }

    if (query && visible[0]) {
      renderAtlasDetail(visible[0], `搜索结果详情 · 共 ${matched.length} 种匹配`);
    }

    if (!visible.length) {
      if (atlasDetail && !options.keepDetail) {
        if (query) {
          atlasDetail.hidden = false;
          atlasDetail.innerHTML = `<div class="atlas-detail-heading"><p class="eyebrow">搜索结果</p><h3>没有找到匹配鸟种</h3><p>可以换一个中文名、英文名或拉丁名再试。</p></div>`;
        } else {
          atlasDetail.hidden = true;
          atlasDetail.innerHTML = "";
        }
      }
      birdGrid.classList.add("is-empty");
      birdGrid.classList.remove("is-marquee");
      if (!query) {
        birdGrid.innerHTML =
          `<article class="bird-card"><div><h3>没有找到鸟种</h3><p>可以换一个中文名、英文名或拉丁名再试。</p></div></article>`;
      }
      return;
    }

    if (query) {
      birdGrid.innerHTML = "";
      birdGrid.hidden = true;
      stopAtlasMarqueeAutoScroll();
      return;
    }

    birdGrid.classList.remove("is-empty");
    birdGrid.hidden = false;
    birdGrid.classList.add("is-marquee");
    birdGrid.innerHTML = renderAtlasMarquee(visible);
    syncAtlasMarqueeAutoScroll();
  } catch (error) {
    if (runId !== atlasRenderRunId) return;

    stopAtlasMarqueeAutoScroll();
    if (isSearching && atlasDetail) {
      atlasDetail.hidden = false;
      atlasDetail.innerHTML = `<div class="atlas-detail-heading"><p class="eyebrow">搜索失败</p><h3>暂时无法加载图鉴</h3><p>${escapeHtml(error.message || "请稍后重试。")}</p></div>`;
      return;
    }
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
  const duplicateCards = entries.map((entry) => renderAtlasCard(entry, { duplicate: true })).join("");

  return `
    <div class="bird-marquee" aria-label="默认鸟类卡片滚动列表">
      <div class="bird-track">${cards}</div>
      <div class="bird-track" aria-hidden="true">${duplicateCards}</div>
    </div>
  `;
}

function shouldUseTouchAtlasMarquee() {
  return Boolean(window.matchMedia?.(ATLAS_TOUCH_MARQUEE_QUERY).matches);
}

function getAtlasMarqueeLoopWidth() {
  const marquee = birdGrid?.querySelector(".bird-marquee");
  const firstTrack = marquee?.querySelector(".bird-track:not([aria-hidden='true'])");
  if (!marquee || !firstTrack) return 0;

  const marqueeStyle = window.getComputedStyle(marquee);
  const trackGap = Number.parseFloat(marqueeStyle.columnGap || marqueeStyle.gap || "0") || 0;
  return firstTrack.getBoundingClientRect().width + trackGap;
}

function stopAtlasMarqueeAutoScroll(options = {}) {
  if (atlasMarqueeAutoScrollFrame) {
    window.cancelAnimationFrame(atlasMarqueeAutoScrollFrame);
    atlasMarqueeAutoScrollFrame = null;
  }

  atlasMarqueeAutoScrollLastTime = 0;
  birdGrid?.classList.remove("is-auto-scrolling");

  if (options.clearResumeTimer !== false) {
    window.clearTimeout(atlasMarqueeResumeTimer);
    atlasMarqueeResumeTimer = null;
  }
}

function startAtlasMarqueeAutoScroll() {
  if (
    atlasMarqueeAutoScrollFrame ||
    atlasMarqueeUserActive ||
    !birdGrid?.classList.contains("is-marquee") ||
    !shouldUseTouchAtlasMarquee()
  ) {
    return;
  }

  birdGrid.classList.add("is-auto-scrolling");

  const step = (timestamp) => {
    if (
      atlasMarqueeUserActive ||
      !birdGrid?.classList.contains("is-marquee") ||
      !shouldUseTouchAtlasMarquee()
    ) {
      stopAtlasMarqueeAutoScroll({ clearResumeTimer: false });
      return;
    }

    if (!atlasMarqueeAutoScrollLastTime) {
      atlasMarqueeAutoScrollLastTime = timestamp;
    }

    const elapsedSeconds = Math.min((timestamp - atlasMarqueeAutoScrollLastTime) / 1000, 0.05);
    atlasMarqueeAutoScrollLastTime = timestamp;

    const loopWidth = getAtlasMarqueeLoopWidth();
    if (loopWidth > 0) {
      if (birdGrid.scrollLeft >= loopWidth) {
        birdGrid.scrollLeft -= loopWidth;
      }

      birdGrid.scrollLeft += ATLAS_TOUCH_MARQUEE_SPEED * elapsedSeconds;
    }

    atlasMarqueeAutoScrollFrame = window.requestAnimationFrame(step);
  };

  atlasMarqueeAutoScrollFrame = window.requestAnimationFrame(step);
}

function syncAtlasMarqueeAutoScroll() {
  stopAtlasMarqueeAutoScroll();
  atlasMarqueeUserActive = false;

  if (!birdGrid?.classList.contains("is-marquee")) return;

  if (!shouldUseTouchAtlasMarquee()) {
    birdGrid.scrollLeft = 0;
    return;
  }

  startAtlasMarqueeAutoScroll();
}

function pauseAtlasMarqueeForUser() {
  atlasMarqueeUserActive = true;
  stopAtlasMarqueeAutoScroll();
}

function resumeAtlasMarqueeAfterUser() {
  window.clearTimeout(atlasMarqueeResumeTimer);
  atlasMarqueeResumeTimer = window.setTimeout(() => {
    atlasMarqueeUserActive = false;
    startAtlasMarqueeAutoScroll();
  }, ATLAS_TOUCH_MARQUEE_RESUME_DELAY_MS);
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
    const pauseMarquee = () => {
      birdGrid.classList.add("is-paused");
      pauseAtlasMarqueeForUser();
    };
    const resumeMarquee = () => {
      if (birdGrid.contains(document.activeElement)) return;
      birdGrid.classList.remove("is-paused");
      resumeAtlasMarqueeAfterUser();
    };

    birdGrid.addEventListener("pointerenter", pauseMarquee);
    birdGrid.addEventListener("pointerdown", pauseMarquee);
    birdGrid.addEventListener("focusin", pauseMarquee);
    birdGrid.addEventListener("pointerleave", resumeMarquee);
    birdGrid.addEventListener("pointerup", resumeMarquee);
    birdGrid.addEventListener("pointercancel", resumeMarquee);
    birdGrid.addEventListener("touchstart", pauseMarquee, { passive: true });
    birdGrid.addEventListener("touchend", resumeMarquee);
    birdGrid.addEventListener("touchcancel", resumeMarquee);
    birdGrid.addEventListener("focusout", () => {
      window.setTimeout(resumeMarquee, 0);
    });
    window.addEventListener("resize", syncAtlasMarqueeAutoScroll);

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
      const atlasTrigger = event.target.closest("[data-candidate-atlas]");
      if (atlasTrigger) {
        openAtlasDetailByIndex(Number(atlasTrigger.dataset.candidateAtlas), {
          context: "识别候选详情",
          syncSearch: true,
          scroll: true,
        });
        return;
      }

      const trigger = event.target.closest("[data-candidate-select]");
      if (!trigger) return;

      const selected = currentRecognitionCandidates.find(
        (candidate) => String(candidate.index) === String(trigger.dataset.candidateSelect)
      );
      selectRecognitionCandidate(selected);
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
  const recognitionSaved =
    canUseResult && savedObservation && buildRecognitionSaveKey() === lastSavedRecognitionKey;
  const recognitionAlreadyShared =
    recognitionSaved && currentRecognitionShareKey && currentRecognitionShareKey === lastSharedRecognitionKey;

  if (useDetected) {
    useDetected.disabled = !canUseResult;
    useDetected.setAttribute("aria-disabled", String(!canUseResult));
  }

  if (saveObservationButton) {
    const canSave = canUseResult && currentRecognitionImagePayload && !recognitionSaved;
    saveObservationButton.disabled = !canSave;
    saveObservationButton.setAttribute("aria-disabled", String(!canSave));
    saveObservationButton.textContent = recognitionSaved ? "已保存到我的观测记录" : "确认并保存观测记录";
  }

  if (shareDetectedButton) {
    const canPublish = isCapabilityEnabled("communityPublish");
    const canShare = canPublish && recognitionSaved && !recognitionAlreadyShared;
    shareDetectedButton.disabled = !canShare;
    shareDetectedButton.setAttribute("aria-disabled", String(!canShare));
    shareDetectedButton.title = canPublish ? "" : getCapabilityDisabledReason("communityPublish");
    shareDetectedButton.textContent = recognitionAlreadyShared
      ? "已发布"
      : recognitionSaved
        ? "发布到社区"
        : "保存后发布到社区";
  }
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
      const atlasNote = !candidate.isMapped
        ? "标签待映射"
        : candidate.atlasBird
          ? "图鉴已收录"
          : "图鉴待补充";
      const selectedClass = selectedRecognitionCandidate?.index === candidate.index ? " is-selected" : "";

      return `
        <li>
          <div class="candidate-row">
            <button class="candidate-open${selectedClass}" type="button" data-candidate-select="${candidate.index}">
              <span>
                <strong>${index + 1}. ${escapeHtml(candidate.cn)}</strong>
                <small>${escapeHtml(candidate.en || "英文名待补充")}${escapeHtml(latin)}</small>
              </span>
              <span>
                <b>${escapeHtml(formatCandidateScore(candidate.probability))}</b>
                <em>${escapeHtml(selectedClass ? "已选择" : atlasNote)}</em>
              </span>
            </button>
            <button class="candidate-atlas" type="button" data-candidate-atlas="${candidate.index}">图鉴</button>
          </div>
        </li>
      `;
    })
    .join("");
}

function createCandidateBird(candidate) {
  const labelState = candidate.isMapped ? "本地图鉴还没有补充详细资料" : "标签映射表还没有补齐";

  return {
    name: candidate.cn,
    latin: candidate.latin || candidate.en || "OSEA 输出标签",
    place: candidate.isMapped ? "图鉴资料待补充" : "标签映射待补齐",
    feature: `${candidate.cn}${candidate.en ? ` / ${candidate.en}` : ""} 是 OSEA 全量模型返回的候选结果，当前${labelState}。`,
    food: "待补充",
    clue: "建议结合照片主体大小、拍摄地点和 Top 候选继续判断。",
  };
}

function buildRecognitionShareKey(bird, candidate) {
  return [
    bird.name,
    bird.latin,
    bird.feature,
    candidate?.index ?? "",
    Math.round((candidate?.probability || 0) * 1000000),
    savedObservation?.id || "",
  ].join("|");
}

function selectRecognitionCandidate(candidate) {
  if (!candidate || !confidenceText || !resultName || !resultMeta || !resultFeature) return;

  const bird = candidate.atlasBird || createCandidateBird(candidate);
  const confidence = displayConfidence(candidate.probability);
  const keepSavedObservation =
    savedObservation &&
    selectedRecognitionCandidate?.index === candidate.index &&
    buildRecognitionSaveKey() === lastSavedRecognitionKey;
  selectedRecognitionCandidate = candidate;
  detectedBird = bird;
  if (!keepSavedObservation) {
    savedObservation = null;
    lastSavedRecognitionKey = "";
    lastSharedRecognitionKey = "";
  }
  currentRecognitionShareKey = buildRecognitionShareKey(bird, candidate);
  confidenceText.textContent = `${confidence}%`;
  resultName.textContent = bird.name;
  resultMeta.textContent = `${bird.latin} · ${bird.place}`;
  resultFeature.textContent = bird.feature;
  renderCandidateList(currentRecognitionCandidates);
  setConfidenceRing(confidence);
  setObservationMessage("");
  updateRecognitionActions();
}

function setResult(
  bird,
  confidence = 92,
  detail = "模型已匹配到图鉴中的常见鸟种。",
  candidates = []
) {
  if (!confidenceText || !resultName || !resultMeta || !resultFeature || !modelDetail) return;

  setRecognitionVisualPending(false);
  detectedBird = bird;
  lastRecognitionStatus = "success";
  currentRecognitionCandidates = candidates;
  selectedRecognitionCandidate = candidates[0] || null;
  savedObservation = null;
  lastSavedRecognitionKey = "";
  lastSharedRecognitionKey = "";
  currentRecognitionShareKey = buildRecognitionShareKey(bird, selectedRecognitionCandidate);
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
  currentRecognitionShareKey = "";
  currentRecognitionSource = "osea-browser";
  currentRecognitionCandidates = [];
  selectedRecognitionCandidate = null;
  savedObservation = null;
  lastSavedRecognitionKey = "";
  confidenceText.textContent = "...";
  resultName.textContent = "正在识别";
  resultMeta.textContent = "AI 模型正在分析这张照片";
  resultFeature.textContent = "请稍等几秒，首次加载模型可能会更慢。";
  modelDetail.textContent = text;
  setCandidateListMessage("模型运行完成后会显示 Top 5 候选。");
  setConfidenceRing(100, "#9ba9a2");
  updateRecognitionActions();
}

function setRecognitionVisualPending(isPending) {
  if (!uploadZone) return;

  uploadZone.classList.toggle("is-recognizing", isPending);
  if (isPending) {
    uploadZone.setAttribute("aria-busy", "true");
  } else {
    uploadZone.removeAttribute("aria-busy");
  }
}

function setUnknownResult(predictions, candidates = []) {
  if (!confidenceText || !resultName || !resultMeta || !resultFeature || !modelDetail) return;

  setRecognitionVisualPending(false);
  lastRecognitionStatus = "unknown";
  currentRecognitionShareKey = "";
  currentRecognitionCandidates = candidates;
  selectedRecognitionCandidate = candidates[0] || null;
  savedObservation = null;
  lastSavedRecognitionKey = "";
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
  currentRecognitionSource = result.source || "osea-browser";
  const top = result.top;
  const bird = top.atlasBird || createCandidateBird(top);
  const confidence = displayConfidence(top.probability);
  const outputCount = result.outputCount || OSEA_EXPECTED_OUTPUT_COUNT;
  const labelCount = result.labelCount || 0;
  const coverageNote = result.unmappedOutputCount
    ? `；${result.unmappedOutputCount.toLocaleString("zh-CN")} 个输出类仍待补标签映射`
    : "";
  const topLabel = top.en ? `${top.cn} / ${top.en}` : top.cn;
  const sourceNote = currentRecognitionSource === "osea-server" ? "兼容识别服务" : "OSEA 模型";
  const detail = top.isMapped
    ? top.atlasBird
      ? `${sourceNote} ${outputCount.toLocaleString("zh-CN")} 维输出，已映射 ${labelCount.toLocaleString("zh-CN")} 个标签${coverageNote}。Top 1：${topLabel}。`
      : `${sourceNote} ${outputCount.toLocaleString("zh-CN")} 维输出，已映射 ${labelCount.toLocaleString("zh-CN")} 个标签${coverageNote}。Top 1：${topLabel}，本地图鉴资料待补充。`
    : `${sourceNote} ${outputCount.toLocaleString("zh-CN")} 维输出，Top 1 落在未映射输出类：${topLabel}。需要补齐标签映射后才能给出正式鸟种名。`;

  setResult(bird, confidence, detail, result.candidates);
}

function getRecognitionFailureCopy(error) {
  if (window.location.protocol === "file:") {
    return {
      name: "识别失败",
      meta: "模型资源无法从 file:// 加载",
      feature: "请使用 http://localhost 或正式网址打开网站，直接 file:// 打开无法加载模型资源。",
    };
  }

  if (error?.recognitionKind === "image-read") {
    return {
      name: "图片读取失败",
      meta: "这张图片没有被当前浏览器成功解码",
      feature: "请换一张 JPG/PNG 截图，或在 iPhone 相册里先截图后再上传。",
    };
  }

  if (error?.recognitionKind === "heic-conversion") {
    return {
      name: "图片转换失败",
      meta: "iPhone 高效率照片暂时无法转换",
      feature: "请上传截图、微信保存后的 JPG，或把相机格式改为“最兼容”后重拍。",
    };
  }

  if (error?.recognitionKind === "server") {
    return {
      name: "识别服务连接失败",
      meta: "兼容识别服务没有完成本次分析",
      feature: "请检查网络后重新选择照片；如果是在微信内打开，也可以点右上角用 Safari 打开。",
    };
  }

  return {
    name: "识别失败",
    meta: "浏览器模型运行失败",
    feature: "请重新选择照片；如果在 iPhone 微信内打开，系统会自动尝试兼容识别服务。",
  };
}

function setRecognitionFailure(error) {
  if (!confidenceText || !resultName || !resultMeta || !resultFeature || !modelDetail) return;

  const copy = getRecognitionFailureCopy(error);
  lastRecognitionStatus = "failed";
  currentRecognitionShareKey = "";
  currentRecognitionImagePayload = null;
  currentRecognitionSource = "osea-browser";
  savedObservation = null;
  lastSavedRecognitionKey = "";
  setRecognitionVisualPending(false);
  uploadZone.classList.remove("has-image");
  preview.removeAttribute("src");
  confidenceText.textContent = "!";
  resultName.textContent = copy.name;
  resultMeta.textContent = copy.meta;
  resultFeature.textContent = copy.feature;
  modelDetail.textContent = withRequestId(error?.message || "未知错误", error);
  setCandidateListMessage("识别失败，暂无候选结果。");
  setConfidenceRing(100, "#b36b5e");
  updateRecognitionActions();
}

function showRecognitionResult(result) {
  if (!result.top) {
    setUnknownResult("模型没有返回可用候选。", result.candidates || []);
    return;
  }

  if (!result.top.isMapped) {
    setUnknownResult(
      `Top 1 落在未映射 OSEA 输出类：${result.top.cn}。需要补齐标签映射后才能给出正式鸟种名。`,
      result.candidates
    );
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
}

function initBirdRecognition() {
  if (!upload || !preview || !uploadZone) return;

  updateRecognitionActions();

  upload.addEventListener("change", async () => {
    const file = upload.files[0];
    if (!file) return;
    const runId = ++recognitionRunId;
    const reportRecognitionStage = (text) => {
      if (runId === recognitionRunId) {
        setPendingResult(text);
      }
    };

    uploadZone.classList.remove("has-image");
    setRecognitionVisualPending(false);
    currentRecognitionImagePayload = null;
    savedObservation = null;
    lastSavedRecognitionKey = "";
    lastSharedRecognitionKey = "";
    currentRecognitionSource = "osea-browser";
    setObservationMessage("");
    reportRecognitionStage("正在读取照片并准备 OSEA 鸟类识别模型...");

    try {
      const recognitionFile = await prepareRecognitionImageFile(file, reportRecognitionStage);
      await loadPreviewImage(recognitionFile);
      if (runId !== recognitionRunId) return;

      uploadZone.classList.add("has-image");
      setRecognitionVisualPending(true);
      currentRecognitionImagePayload = buildCompressedObservationImage(preview, recognitionFile);
      const result = await classifyImageWithFallback(preview, currentRecognitionImagePayload, reportRecognitionStage);
      if (runId !== recognitionRunId) return;

      showRecognitionResult(result);
    } catch (error) {
      if (runId !== recognitionRunId) return;
      setRecognitionFailure(error);
    }
  });

  window.__birdoraRecognitionReady = true;
}

function buildCurrentObservationPayload() {
  const candidate = selectedRecognitionCandidate;
  if (!candidate || !currentRecognitionImagePayload) return null;

  return {
    selectedSpeciesName: candidate.cn,
    selectedSpeciesScientificName: candidate.latin || "",
    confidence: candidate.probability,
    topCandidates: currentRecognitionCandidates.map((item, index) => buildCandidatePayload(item, index + 1)),
    source: currentRecognitionSource || "osea-browser",
    observedAt: new Date().toISOString(),
    ...currentRecognitionImagePayload,
  };
}

async function saveCurrentObservation() {
  if (!observationApi) {
    setObservationMessage("观测记录服务暂不可用，请刷新页面后重试。");
    return;
  }

  if (!requireLoginForAction()) return;

  if (lastRecognitionStatus !== "success" || !selectedRecognitionCandidate) {
    upload?.focus();
    return;
  }

  const payload = buildCurrentObservationPayload();
  if (!payload) {
    setObservationMessage("识别图片还没有准备好，请重新选择照片后再保存。");
    return;
  }

  const saveKey = buildRecognitionSaveKey();
  if (savedObservation && saveKey && saveKey === lastSavedRecognitionKey) {
    setObservationMessage("已保存到我的观测记录。");
    return;
  }

  saveObservationButton.disabled = true;
  setObservationMessage("正在保存观测记录...");

  try {
    const observation = await observationApi.createObservation(payload);
    savedObservation = observation;
    lastSavedRecognitionKey = saveKey;
    currentRecognitionShareKey = buildRecognitionShareKey(detectedBird, selectedRecognitionCandidate);
    syncObservationState(observation);
    observationsLoadState = "ready";
    setObservationMessage("已保存到我的观测记录。");
    renderObservationList();
    updateRecognitionActions();
  } catch (error) {
    setObservationMessage(getObservationMutationMessage(error, "保存失败，请稍后重试。"));
    if (error?.status === 401) {
      clearAuthState();
      renderObservationList();
    }
  } finally {
    updateRecognitionActions();
  }
}

async function publishObservationToCommunity(observation, trigger = null) {
  if (!observation) return;
  if (!isCapabilityEnabled("communityPublish")) {
    setObservationMessage(getCapabilityDisabledReason("communityPublish"));
    return;
  }
  if (!requireLoginForAction()) return;

  const button = trigger || null;
  if (button) {
    button.disabled = true;
    button.textContent = "正在发布...";
  }

  try {
    const newPost = await communityApi.create(normalizeObservationForPost(observation));
    syncCommunityPostState(newPost);
    renderCurrentFeed();
    setObservationMessage("已从观测记录发布到社区。");
    if (button) {
      button.textContent = "已发布";
    }
  } catch (error) {
    setObservationMessage(getCommunityMutationMessage(error, "发布失败，请稍后重试。"));
    if (error?.status === 401) {
      clearAuthState();
      renderObservationList();
    }
    if (button) {
      button.disabled = false;
      button.textContent = "发布到社区";
    }
  }
}

function initObservationListActions() {
  if (!observationList) return;

  observationList.addEventListener("click", async (event) => {
    const retry = event.target.closest("[data-observation-retry]");
    if (retry) {
      await loadMyObservations();
      return;
    }

    const trigger = event.target.closest("[data-observation-share]");
    if (!trigger) return;

    const observation = observations.find((item) => item.id === trigger.dataset.observationShare);
    await publishObservationToCommunity(observation, trigger);
  });
}

function initPublishing() {
  if (postForm && postTitle && postBody) {
    const updatePostImageName = () => {
      if (!postImageName) return;

      const selectedFileName = postImage?.files?.[0]?.name || "";
      postImageName.textContent = selectedFileName || "未选择图片";
      postImageName.title = selectedFileName;
    };

    const setPostMessage = (text = "") => {
      if (postMessage) {
        postMessage.textContent = text;
      }
    };

    [postTitle, postBody].forEach((field) => {
      field.addEventListener("input", () => {
        field.setAttribute("aria-invalid", "false");
        if (postTitle.value.trim() && postBody.value.trim()) {
          setPostMessage("");
        }
      });
    });

    postImage?.addEventListener("change", () => {
      updatePostImageName();
      setPostMessage("");
    });

    updatePostImageName();

    postForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (!isCapabilityEnabled("communityPublish")) {
        setPostMessage(getCapabilityDisabledReason("communityPublish"));
        applyRuntimeCapabilityControls();
        return;
      }

      if (!requireLoginForAction()) return;

      const title = normalizeUserText(postTitle.value, POST_TITLE_MAX_LENGTH);
      const body = normalizeUserText(postBody.value, POST_BODY_MAX_LENGTH);
      postTitle.setAttribute("aria-invalid", String(!title));
      postBody.setAttribute("aria-invalid", String(!body));

      if (!title || !body) {
        setPostMessage(title ? "请先写下观察内容。" : "请先填写记录标题。");
        (title ? postBody : postTitle).focus();
        return;
      }

      const submitButton = postForm.querySelector('[type="submit"]');
      setPostMessage("正在发布...");
      submitButton.disabled = true;

      try {
        const imagePayload = await readPostImageForUpload(postImage?.files?.[0]);
        const newPost = await communityApi.create({
          title,
          body,
          bird: lastRecognitionStatus === "success" ? detectedBird.name : "观鸟笔记",
          ...(imagePayload || {}),
        });

        syncCommunityPostState(newPost);
        postForm.reset();
        updatePostImageName();
        postTitle.setAttribute("aria-invalid", "false");
        postBody.setAttribute("aria-invalid", "false");
        setPostMessage("发布成功，所有社区用户现在都能看到这条笔记。");
        renderCurrentFeed();
      } catch (error) {
        setPostMessage(getCommunityMutationMessage(error, "发布失败，请稍后重试。"));
        if (error?.status === 401) {
          clearAuthState();
        }
      } finally {
        submitButton.disabled = !isCapabilityEnabled("communityPublish");
      }
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
      postTitle.setAttribute("aria-invalid", "false");
      postBody.setAttribute("aria-invalid", "false");
      if (postMessage) {
        postMessage.textContent = "";
      }
      postBody.focus();
    });
  }

  if (saveObservationButton) {
    updateRecognitionActions();
    saveObservationButton.addEventListener("click", saveCurrentObservation);
  }

  const shareDetectedButton = document.querySelector("#shareDetected");
  if (shareDetectedButton) {
    updateRecognitionActions();
    shareDetectedButton.addEventListener("click", async () => {
      if (!isCapabilityEnabled("communityPublish")) {
        setObservationMessage(getCapabilityDisabledReason("communityPublish"));
        applyRuntimeCapabilityControls();
        return;
      }
      if (!requireLoginForAction()) return;

      if (lastRecognitionStatus !== "success") {
        upload?.focus();
        return;
      }

      if (!savedObservation || buildRecognitionSaveKey() !== lastSavedRecognitionKey) {
        setObservationMessage("请先确认并保存观测记录，再发布到社区。");
        saveObservationButton?.focus();
        return;
      }

      if (currentRecognitionShareKey && currentRecognitionShareKey === lastSharedRecognitionKey) {
        document.querySelector("#publish")?.scrollIntoView({ behavior: "smooth" });
        return;
      }

      shareDetectedButton.disabled = true;
      try {
        const newPost = await communityApi.create(normalizeObservationForPost(savedObservation));
        syncCommunityPostState(newPost);
        lastSharedRecognitionKey = currentRecognitionShareKey;
        setObservationMessage("已从观测记录发布到社区。");
        updateRecognitionActions();
        renderCurrentFeed();
        document.querySelector("#publish")?.scrollIntoView({ behavior: "smooth" });
      } catch (error) {
        setObservationMessage(getCommunityMutationMessage(error, "发布失败，请稍后重试。"));
        if (error?.status === 401) {
          clearAuthState();
        }
      } finally {
        updateRecognitionActions();
      }
    });
  }

  initObservationListActions();
  window.__birdoraPublishingReady = true;
}

function initScrollButtons() {
  document.querySelectorAll("[data-scroll]").forEach((button) => {
    button.addEventListener("click", () => {
      scrollToHomeTarget(button.dataset.scroll);
    });
  });

  if (page !== "home") return;

  document.querySelectorAll('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const target = link.getAttribute("href");
      if (!target || target === "#") return;

      event.preventDefault();
      scrollToHomeTarget(target);
    });
  });
}

function getHomeViewFromHash(hash = window.location.hash) {
  const target = String(hash || "").replace(/^#/, "");

  if (target === "identify" || target === "observations") {
    return "identify";
  }

  if (target === "atlas") {
    return "atlas";
  }

  if (target === "community" || target === "publish") {
    return "community";
  }

  return "home";
}

function syncHomeView(hash = window.location.hash) {
  if (page !== "home") return;

  document.body.dataset.homeView = getHomeViewFromHash(hash);
}

function scrollToHomeTarget(target) {
  if (!target) return;

  if (page === "home") {
    syncHomeView(target);
  }

  const targetElement = document.querySelector(target);
  targetElement?.scrollIntoView({ behavior: "smooth", block: target === "#home" ? "start" : "start" });

  if (target === "#home") {
    window.history.pushState(null, "", `${window.location.pathname}${window.location.search}`);
    return;
  }

  window.history.pushState(null, "", target);
}

window.addEventListener("hashchange", () => syncHomeView());
window.addEventListener("popstate", () => syncHomeView());

function getSavedDeviceConnectionState() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEYS.deviceConnected);
    return saved === "connected" || saved === "true" ? "connected" : "disconnected";
  } catch {
    return "disconnected";
  }
}

function initDeviceConnection() {
  updateDeviceConnectionUI(getSavedDeviceConnectionState());
  if (!deviceConnectBtn) return;

  deviceConnectBtn.addEventListener("click", () => {
    const currentState = deviceConnectBtn.dataset.deviceState || "disconnected";

    if (currentState === "connecting") {
      return;
    }

    if (currentState === "connected") {
      window.clearTimeout(deviceConnectionTimer);
      try {
        window.localStorage.setItem(STORAGE_KEYS.deviceConnected, "disconnected");
      } catch {
        // Device connection is simulated; storage failure should not block the UI.
      }
      deviceConnectionTimer = null;
      updateDeviceConnectionUI("disconnected");
      return;
    }

    updateDeviceConnectionUI("connecting");
    window.clearTimeout(deviceConnectionTimer);
    deviceConnectionTimer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEYS.deviceConnected, "connected");
      } catch {
        // Keep the visible connected state even if browser storage is unavailable.
      }
      updateDeviceConnectionUI("connected");
      deviceConnectionTimer = null;
    }, 1500);
  });
}

function syncHomeCommunityReveal() {
  if (page === "community") return;

  const preview = document.querySelector("#publish .feed-preview");
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

  const preview = document.querySelector("#publish .feed-preview");
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
    ".hero, .hero-section, .identify-section, #identify, .bird-section, .atlas-section, #atlas, .community-section, #publish, .device-section, #device"
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
    window.location.replace(getPostLoginUrl());
    return;
  }

  clearAuthState();
  initAuthForms();
}

function renderUserChrome() {
  const displayName = currentUser?.nickname || currentUser?.email?.split("@")[0] || "";

  userNameBadges.forEach((badge) => {
    if (!displayName) {
      badge.textContent = "";
      badge.removeAttribute("title");
      badge.removeAttribute("aria-label");
      badge.hidden = true;
      return;
    }

    badge.textContent = displayName;
    badge.title = displayName;
    badge.setAttribute("aria-label", `当前用户：${displayName}`);
    badge.hidden = false;
  });

  logoutButtons.forEach((button) => {
    button.textContent = currentUser ? "退出登录" : "登录";
    button.setAttribute("aria-label", currentUser ? "退出登录" : "登录 Birdora");
    button.hidden = !currentUser && loginLinks.length + registerLinks.length > 0;
  });

  loginLinks.forEach((link) => {
    link.href = getLoginUrl();
    link.hidden = Boolean(currentUser);
  });

  registerLinks.forEach((link) => {
    link.href = getRegisterUrl();
    link.hidden = Boolean(currentUser);
  });
}

function translateAuthMessage(message, fallback = "认证请求失败，请稍后重试。") {
  const messages = {
    "email and password are required": "请先填写邮箱和密码。",
    "email format is invalid": "邮箱格式不正确，请检查后重试。",
    "password must be at least 8 characters": "密码至少需要 8 位。",
    "email is already registered": "这个邮箱已经注册过了，请直接登录。",
    "email or password is incorrect": "邮箱或密码不正确，请检查后重试。",
    Unauthorized: "登录状态已失效，请重新登录。",
  };

  return messages[message] || message || fallback;
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

  if (authPageSwitchLink) {
    const targetMode = form.dataset.authMode === "register" ? "login" : "register";
    authPageSwitchLink.setAttribute("href", getAuthSwitchUrl(targetMode));
  }

  const modeConfig = {
    login: {
      eyebrow: "登录",
      title: "继续你的观鸟记录",
      copy: "登录 Birdora，继续保存你的观鸟笔记、评论和识别记录。",
      submit: "登录",
    },
    register: {
      eyebrow: "注册",
      title: "创建你的 Birdora 账号",
      copy: "注册后可以保存识别记录、发布观鸟笔记，并在设备页同步眼镜数据。",
      submit: "注册并进入",
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
  };

  const setAuthMode = (mode) => {
    const config = modeConfig[mode] || modeConfig.login;
    form.dataset.authMode = mode;

    if (authModeEyebrow) authModeEyebrow.textContent = config.eyebrow;
    if (authModeTitle) authModeTitle.textContent = config.title;
    if (authModeCopy) authModeCopy.textContent = config.copy;
    if (authSubmitBtn) authSubmitBtn.textContent = config.submit;

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
        window.location.replace(getPostLoginUrl());
      } catch (error) {
        setMessage(withRequestId(error.message || "注册失败，请稍后重试。", error));
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
      window.location.replace(getPostLoginUrl());
    } catch (error) {
      setMessage(withRequestId(error.message || "登录失败，请稍后重试。", error));
    } finally {
      setSubmitting(false);
    }
  });

  setAuthMode(form.dataset.authMode || "login");
  window.__birdoraAuthFormsReady = true;
}

function updateDeviceConnectionUI(state) {
  if (
    !deviceConnectionTitle ||
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
  if (deviceConnectBtn) {
    deviceConnectBtn.textContent = isConnecting ? "连接中..." : isConnected ? "断开连接" : "连接设备";
    deviceConnectBtn.disabled = isConnecting;
    deviceConnectBtn.classList.toggle("is-connecting", isConnecting);
    deviceConnectBtn.setAttribute("aria-busy", String(isConnecting));
    deviceConnectBtn.setAttribute("data-device-state", state);
  }
  deviceBatteryValue.textContent = isConnected ? "86%" : "--";
  deviceStorageValue.textContent = isConnected ? "32.4GB" : "--";
  deviceFirmwareValue.textContent = isConnected ? "V2.0.5" : "--";
  deviceSyncStatus.textContent = isConnecting
    ? "正在搜索附近的 Birdora Glasses..."
    : isConnected
      ? "蓝牙在线 · 最近同步 3 分钟前"
      : "蓝牙未连接";
  deviceSyncStatus.classList.toggle("is-connecting", isConnecting);
}

function setDeviceToolMessage(message) {
  if (deviceToolMessage) deviceToolMessage.textContent = message;
}

function initDeviceTools() {
  const toolButtons = document.querySelectorAll("[data-device-tool]");
  if (!toolButtons.length) return;

  toolButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const connected = deviceConnectBtn?.dataset.deviceState === "connected";
      if (!connected) {
        setDeviceToolMessage("请先连接 Birdora Glasses，再使用同步、固件和存储工具。");
        return;
      }

      const tool = button.dataset.deviceTool;
      if (tool === "sync") {
        button.disabled = true;
        setDeviceToolMessage("正在同步最近拍摄的鸟照...");
        window.setTimeout(() => {
          button.disabled = false;
          deviceSyncStatus.textContent = "蓝牙在线 · 刚刚完成同步";
          setDeviceToolMessage("同步完成。最近拍摄的鸟照已准备好，可前往识别页面继续查看。");
        }, 700);
        return;
      }

      if (tool === "firmware") {
        setDeviceToolMessage("已检查设备版本：V2.0.5 已是当前稳定版本。");
        return;
      }

      setDeviceToolMessage("可用空间为 32.4GB，当前可以继续同步新的拍摄记录。");
    });
  });
}

async function initAuthenticatedPage() {
  currentUser = null;
  syncHomeView();
  renderUserChrome();

  initAtlasSearch();
  bindCommentFeed(feed);
  bindCommentFeed(communityFeed);
  initPostDetailDialog();
  initCommunityTabs();
  initLogoutButtons();
  initBirdRecognition();
  initPublishing();
  initScrollButtons();
  initDeviceConnection();
  initDeviceTools();
  renderCurrentFeed();
  renderObservationList();
  updateModelReadiness();
  renderBirds();
  initHomeCommunityReveal();
  initSoftReveal();

  Promise.all([loadRuntimeCapabilities(), syncAuthState()])
    .then(async () => {
      if (feed || communityFeed) {
        await loadCommunityPosts();
      }
      await loadMyObservations();
      syncCommunityTabs();
      renderCurrentFeed();
      syncHomeCommunityReveal();
      await loadCommunityWorkspaceData();
      renderProfileCenter();
      applyRuntimeCapabilityControls();
    })
    .catch(() => {
      renderUserChrome();
      renderObservationList();
    });

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
        if (!result.top.isMapped) {
          throw new Error(`自测 Top 1 为未映射输出类：${result.top.cn}。`);
        }
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
  if (page === "login" || page === "register") {
    initLoginPage();
  } else if (APP_PAGES.has(page)) {
    initAuthenticatedPage();
  } else {
    initSoftReveal();
  }
  initTopbarScrollHide();
}

function initTopbarScrollHide() {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;

  let lastScrollY = window.scrollY;
  let ticking = false;

  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const currentScrollY = window.scrollY;
      const scrollDelta = currentScrollY - lastScrollY;
      const threshold = 8;

      if (scrollDelta > threshold && currentScrollY > 60) {
        topbar.classList.add("is-hidden");
      } else if (scrollDelta < -threshold) {
        topbar.classList.remove("is-hidden");
      }

      if (currentScrollY < 10) {
        topbar.classList.remove("is-hidden");
      }

      lastScrollY = currentScrollY;
      ticking = false;
    });
  }, { passive: true });
}

initApp();

/* Community workspace: the community page has its own compact sub-routes. */
const COMMUNITY_VIEWS = new Set(["recommended", "following", "publish", "messages", "personal", "moderation"]);
const COMMUNITY_DRAFT_KEY_PREFIX = "birdora-community-composer-draft";
let communityWorkspacePosts = [];
let communityWorkspaceMediaUrl = "";
let communityWorkspaceLoadState = "loading";
let communityWorkspaceLoadMessage = "";
let communityWorkspaceStats = null;
let communityWorkspaceDraft = null;
let communityWorkspacePublishKey = "";
let communityWorkspaceNotifications = [];
let communityWorkspaceNotificationState = "loading";
let communityWorkspaceNotificationMessage = "";
let communityWorkspaceRoles = [];
let communityWorkspaceRolesLoaded = false;
let communityWorkspaceModerationCases = [];
let communityWorkspaceModerationDetails = new Map();
let communityWorkspaceModerationState = "loading";
let communityWorkspaceModerationMessage = "";

function canUseModerationWorkspace() {
  return communityWorkspaceRoles.some((role) => role === "moderator" || role === "admin");
}

function getCommunityWorkspaceView() {
  const view = new URLSearchParams(window.location.search).get("view") || "recommended";
  return COMMUNITY_VIEWS.has(view) ? view : "recommended";
}

function escapeCommunityText(value) {
  return escapeHtml(String(value || ""));
}

function getCommunityWorkspacePosts(view) {
  return communityWorkspacePosts.map((post) => ({
    ...post,
    likes: Number(post.likeCount ?? post.feedback?.helpful?.count) || 0,
    liked: post.viewerHasLiked === true || post.feedback?.helpful?.selected === true,
    isPersisted: Boolean(post.id && post.createdAt),
    kind: post.videoUrl ? "video" : post.imageUrl ? "image" : "text",
  }));
}

function renderCommunityMedia(post) {
  if (post.videoUrl) {
    return `<video class="community-note-media" controls preload="metadata" src="${escapeCommunityText(post.videoUrl)}"></video>`;
  }
  if (post.imageUrl) {
    return `<img class="community-note-media" src="${escapeCommunityText(post.imageUrl)}" alt="${escapeCommunityText(post.title)}" loading="lazy" />`;
  }
  return post.kind === "text" ? `<div class="community-text-cover"><span>观鸟随记</span><p>${escapeCommunityText(post.body)}</p></div>` : "";
}

function renderCommunityNoteCard(post) {
  const hasBody = Boolean(post.body && post.kind !== "text");
  const canLike = post.isPersisted === true && isCapabilityEnabled("canonicalLike");
  const likeDisabledReason = post.isPersisted === true
    ? getCapabilityDisabledReason("canonicalLike")
    : "此内容不支持持久化点赞";
  const canFollow = Boolean(
    post.authorId
    && !post.canManage
    && post.isPersisted
    && isCapabilityEnabled("socialFeedV1")
  );
  const followAction = canFollow
    ? `<button type="button" class="community-follow-action ${post.viewerFollowsAuthor ? "is-following" : ""}" data-workspace-follow="${escapeCommunityText(post.authorId)}" aria-pressed="${String(Boolean(post.viewerFollowsAuthor))}">${post.viewerFollowsAuthor ? "已关注" : "关注"}</button>`
    : "";
  const canReport = Boolean(
    post.isPersisted
    && !post.canManage
    && isCapabilityEnabled("contentReporting")
  );
  const reportAction = canReport
    ? `
      <details class="community-report-panel">
        <summary>举报</summary>
        <form data-workspace-report="${escapeCommunityText(post.id)}">
          <label><span>原因</span><select name="reason"><option value="spam">垃圾或广告</option><option value="harassment">骚扰或攻击</option><option value="misinformation">误导信息</option><option value="graphic_content">不适宜内容</option><option value="privacy">隐私或敏感地点</option><option value="copyright">版权问题</option><option value="other">其他</option></select></label>
          <label><span>补充说明</span><textarea name="detail" maxlength="500" placeholder="可选，最多 500 字"></textarea></label>
          <button class="secondary-btn" type="submit">提交举报</button>
          <p data-workspace-report-message aria-live="polite"></p>
        </form>
      </details>
    `
    : "";
  return `
    <article class="community-note-card" data-workspace-post="${escapeCommunityText(post.id)}">
      ${renderCommunityMedia(post)}
      <div class="community-note-info">
        <h2>${escapeCommunityText(post.title)}</h2>
        ${hasBody ? `<p>${escapeCommunityText(post.body)}</p>` : ""}
        <div class="community-note-meta"><span>${escapeCommunityText(post.author || "Birdora 用户")}</span>${followAction}<button type="button" data-workspace-like="${escapeCommunityText(post.id)}" class="${post.liked ? "is-liked" : ""}" aria-pressed="${String(Boolean(post.liked))}" aria-label="点赞 ${escapeCommunityText(post.title)}" ${canLike ? "" : `disabled title="${escapeCommunityText(likeDisabledReason)}"`}>赞 ${Number(post.likes) || 0}</button></div>
        ${reportAction}
      </div>
    </article>
  `;
}

function renderCommunityFeedView(view) {
  const label = view === "following" ? "关注" : "推荐";
  const copy = view === "following" ? "你关注的观鸟者最近分享" : "来自 Birdora 社区的观鸟记录";
  const posts = getCommunityWorkspacePosts(view);
  if ((view === "recommended" || view === "following") && communityWorkspaceLoadState === "loading") {
    return `<header class="community-view-heading"><p>${label}</p><h1>今天的观鸟笔记</h1><span>${copy}</span></header><div class="community-empty-state" role="status"><h2>正在加载社区内容</h2><p>正在读取真实用户发布的观鸟记录。</p></div>`;
  }
  if ((view === "recommended" || view === "following") && communityWorkspaceLoadState === "error") {
    return `<header class="community-view-heading"><p>${label}</p><h1>今天的观鸟笔记</h1><span>${copy}</span></header><div class="community-empty-state"><h2>社区内容暂时无法加载</h2><p>${escapeCommunityText(communityWorkspaceLoadMessage)}</p></div>`;
  }
  const emptyState = view === "following"
    ? `<div class="community-empty-state"><h2>还没有关注动态</h2><p>关注其他观鸟者后，他们公开或面向关注者发布的笔记会出现在这里。</p></div>`
    : `<div class="community-empty-state"><h2>暂无公开笔记</h2><p>真实用户发布的观鸟记录会按服务端顺序显示在这里。</p></div>`;
  return `
    <header class="community-view-heading"><p>${label}</p><h1>${view === "following" ? "关注的人正在观察" : "今天的观鸟笔记"}</h1><span>${copy}</span></header>
    <div class="community-note-grid">${posts.length ? posts.map(renderCommunityNoteCard).join("") : emptyState}</div>
  `;
}

function getCommunityDraftKey() {
  if (!currentUser?.id) return null;
  return `${COMMUNITY_DRAFT_KEY_PREFIX}:${encodeURIComponent(String(currentUser.id))}`;
}

function getCommunityDraft() {
  if (isCapabilityEnabled("cloudDrafts")) {
    return communityWorkspaceDraft || {};
  }
  const draftKey = getCommunityDraftKey();
  if (!draftKey) return {};
  try {
    return JSON.parse(window.localStorage.getItem(draftKey) || "{}");
  } catch {
    return {};
  }
}

function renderCommunityPublishView() {
  const draft = getCommunityDraft();
  const previewPosts = getCommunityWorkspacePosts("recommended").slice(0, 3);
  const canPublish = isCapabilityEnabled("communityPublish");
  const publishReason = getCapabilityDisabledReason("communityPublish");
  return `
    <header class="community-view-heading"><p>发布</p><h1>分享一次观察</h1><span>图片、视频和文字都可以成为一条观鸟笔记。</span></header>
    <div class="community-publish-layout">
    <form class="community-composer" id="communityComposer" novalidate>
      <label class="community-field"><span>标题</span><input id="communityComposerTitle" maxlength="80" required placeholder="给这次观察起个标题" value="${escapeCommunityText(draft.title)}" /></label>
      <label class="community-field"><span>地点</span><input id="communityComposerLocation" maxlength="160" placeholder="例如：杭州 · 西湖公园" value="${escapeCommunityText(draft.locationText || draft.location)}" /></label>
      <label class="community-field"><span>谁可以看</span><select id="communityComposerVisibility"><option value="public" ${draft.visibility === "public" || !draft.visibility ? "selected" : ""}>所有人</option><option value="followers" ${draft.visibility === "followers" ? "selected" : ""}>仅关注者</option><option value="private" ${draft.visibility === "private" ? "selected" : ""}>仅自己</option></select></label>
      <label class="community-field community-field-wide"><span>正文</span><textarea id="communityComposerBody" maxlength="600" required placeholder="写下鸟种、天气、环境，或当时让你记住的细节。">${escapeCommunityText(draft.body)}</textarea></label>
      <label class="community-media-picker" for="communityMedia"><input id="communityMedia" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" /><span class="community-media-picker-icon">+</span><strong>添加图片或视频</strong><small>图片最大 1 MiB；MP4 或 WebM 视频最大 8 MiB</small></label>
      <div class="community-media-preview" id="communityMediaPreview" hidden></div>
      <p class="community-composer-message" id="communityComposerMessage" data-community-publish-reason aria-live="polite">${canPublish ? "" : escapeCommunityText(publishReason)}</p>
      <div class="community-composer-actions"><button class="secondary-btn" type="button" data-community-save-draft>存草稿</button><button class="primary-btn" type="submit" data-community-publish-submit ${canPublish ? "" : "disabled"}>发布笔记</button></div>
    </form>
    <aside class="community-publish-aside" aria-label="其他观鸟者的笔记">
      <div class="community-publish-aside-head"><div><p>正在分享</p><h2>他人的观察</h2></div><a href="./community.html?view=recommended">更多</a></div>
      <div class="community-mini-note-list">${previewPosts.map(renderCommunityNoteCard).join("")}</div>
    </aside>
    </div>
  `;
}

function renderCommunityMessagesView() {
  if (!currentUser) {
    return `
      <header class="community-view-heading"><p>消息</p><h1>最近互动</h1><span>与观鸟伙伴保持联系。</span></header>
      <div class="community-empty-state"><h2>登录后查看消息</h2><p>点赞、评论和新关注都会集中显示在这里。</p><a class="primary-btn link-btn" href="${escapeCommunityText(getLoginUrl())}">登录</a></div>
    `;
  }
  if (!isCapabilityEnabled("notifications")) {
    return `
      <header class="community-view-heading"><p>消息</p><h1>最近互动</h1><span>与观鸟伙伴保持联系。</span></header>
      <div class="community-empty-state"><h2>消息中心尚未开放</h2><p>${escapeCommunityText(getCapabilityDisabledReason("notifications"))}</p></div>
    `;
  }
  if (communityWorkspaceNotificationState === "loading") {
    return `<header class="community-view-heading"><p>消息</p><h1>最近互动</h1><span>与观鸟伙伴保持联系。</span></header><div class="community-empty-state" role="status"><h2>正在加载消息</h2></div>`;
  }
  if (communityWorkspaceNotificationState === "error") {
    return `<header class="community-view-heading"><p>消息</p><h1>最近互动</h1><span>与观鸟伙伴保持联系。</span></header><div class="community-empty-state"><h2>消息暂时无法加载</h2><p>${escapeCommunityText(communityWorkspaceNotificationMessage)}</p></div>`;
  }
  const notificationCopy = {
    user_followed: "关注了你",
    post_liked: "赞了你的观鸟笔记",
    post_commented: "评论了你的观鸟笔记",
    comment_replied: "回复了你的评论",
    post_moderation_updated: "你的笔记审核状态已更新",
    system_announcement: "系统通知",
  };
  const cards = communityWorkspaceNotifications.map((notification) => {
    const actor = notification.actor?.nickname || "Birdora";
    const title = notification.payload?.postTitle || "";
    const createdAt = notification.createdAt
      ? new Date(notification.createdAt).toLocaleString("zh-CN", { hour12: false })
      : "";
    return `
      <article class="community-note-card ${notification.readAt ? "is-read" : "is-unread"}">
        <div class="community-note-info">
          <h2>${escapeCommunityText(actor)} ${escapeCommunityText(notificationCopy[notification.type] || "发来一条消息")}</h2>
          ${title ? `<p>${escapeCommunityText(title)}</p>` : ""}
          <div class="community-note-meta"><span>${escapeCommunityText(createdAt)}</span>${notification.readAt ? "<span>已读</span>" : `<button type="button" data-community-notification-read="${escapeCommunityText(notification.id)}">标为已读</button>`}</div>
        </div>
      </article>
    `;
  }).join("");
  return `
    <header class="community-view-heading"><p>消息</p><h1>最近互动</h1><span>与观鸟伙伴保持联系。</span></header>
    ${communityWorkspaceNotifications.some((item) => !item.readAt) ? `<div class="community-composer-actions"><button class="secondary-btn" type="button" data-community-notifications-read-all>全部标为已读</button></div>` : ""}
    <div class="community-note-grid">${cards || `<div class="community-empty-state"><h2>暂无新消息</h2><p>新的点赞、评论和关注会显示在这里。</p></div>`}</div>
  `;
}

function renderModerationCaseDetail(moderationCase) {
  const detail = communityWorkspaceModerationDetails.get(moderationCase.id);
  if (!detail) {
    return `<button class="secondary-btn" type="button" data-moderation-detail="${escapeCommunityText(moderationCase.id)}">查看内容与举报</button>`;
  }
  const reports = (detail.reports || []).map((report) => `
    <li><strong>${escapeCommunityText(report.reason)}</strong><span>${escapeCommunityText(report.detail || "未补充说明")}</span></li>
  `).join("");
  return `
    <section class="moderation-case-detail">
      <h3>${escapeCommunityText(detail.post?.title || moderationCase.post.title)}</h3>
      <p>${escapeCommunityText(detail.post?.body || "")}</p>
      <ul>${reports || "<li>没有举报明细</li>"}</ul>
    </section>
  `;
}

function renderCommunityModerationView() {
  const heading = `<header class="community-view-heading"><p>运营</p><h1>审核工作台</h1><span>处理用户举报并保留完整操作审计。</span></header>`;
  if (!currentUser) {
    return `${heading}<div class="community-empty-state"><h2>请先登录</h2><p>审核工作台仅对受控审核员开放。</p><a class="primary-btn link-btn" href="${escapeCommunityText(getLoginUrl())}">登录</a></div>`;
  }
  if (!communityWorkspaceRolesLoaded) {
    return `${heading}<div class="community-empty-state" role="status"><h2>正在核验权限</h2></div>`;
  }
  if (!canUseModerationWorkspace()) {
    return `${heading}<div class="community-empty-state"><h2>没有审核权限</h2><p>审核员角色只能通过受控运维命令授予，网页不能自助提权。</p></div>`;
  }
  if (communityWorkspaceModerationState === "loading") {
    return `${heading}<div class="community-empty-state" role="status"><h2>正在加载举报队列</h2></div>`;
  }
  if (communityWorkspaceModerationState === "error") {
    return `${heading}<div class="community-empty-state"><h2>审核队列暂时不可用</h2><p>${escapeCommunityText(communityWorkspaceModerationMessage)}</p><button class="secondary-btn" type="button" data-moderation-refresh>重试</button></div>`;
  }
  const cases = communityWorkspaceModerationCases.map((moderationCase) => {
    const moderationStatus = moderationCase.post?.moderationStatus || "unknown";
    const canRestore = ["hidden", "rejected", "under_review"].includes(moderationStatus);
    return `
      <article class="moderation-case-card" data-moderation-case="${escapeCommunityText(moderationCase.id)}">
        <div class="moderation-case-head"><div><span>${escapeCommunityText(moderationCase.source)}</span><h2>${escapeCommunityText(moderationCase.post?.title || "待审核内容")}</h2></div><strong>${escapeCommunityText(moderationStatus)}</strong></div>
        <p>举报 ${Number(moderationCase.reportCount) || 0} 条 · 未处理 ${Number(moderationCase.openReportCount) || 0} 条</p>
        ${renderModerationCaseDetail(moderationCase)}
        <label class="moderation-reason"><span>决定理由（必填）</span><textarea maxlength="500" data-moderation-reason="${escapeCommunityText(moderationCase.id)}" placeholder="记录事实依据，至少 3 个字符"></textarea></label>
        <div class="community-composer-actions">
          ${canRestore
            ? `<button class="primary-btn" type="button" data-moderation-decision="restore" data-case-id="${escapeCommunityText(moderationCase.id)}">恢复</button>`
            : `<button class="secondary-btn" type="button" data-moderation-decision="approve" data-case-id="${escapeCommunityText(moderationCase.id)}">通过/驳回举报</button><button class="secondary-btn" type="button" data-moderation-decision="reject" data-case-id="${escapeCommunityText(moderationCase.id)}">拒绝内容</button><button class="primary-btn" type="button" data-moderation-decision="hide" data-case-id="${escapeCommunityText(moderationCase.id)}">隐藏内容</button>`}
        </div>
        <p data-moderation-message="${escapeCommunityText(moderationCase.id)}" aria-live="polite"></p>
      </article>
    `;
  }).join("");
  return `${heading}<div class="moderation-toolbar"><button class="secondary-btn" type="button" data-moderation-refresh>刷新队列</button></div><div class="moderation-case-list">${cases || `<div class="community-empty-state"><h2>没有待处理举报</h2><p>当前审核队列为空。</p></div>`}</div>`;
}

function renderCommunityPersonalView() {
  const name = currentUser?.nickname || "访客";
  const ownPosts = getCommunityWorkspacePosts("personal").filter((post) => post.canManage);
  if (communityWorkspaceLoadState === "loading") {
    return `<header class="community-view-heading"><p>个人</p><h1>${escapeCommunityText(name)}的观鸟页</h1></header><div class="community-empty-state" role="status"><h2>正在加载你的笔记</h2></div>`;
  }
  return `
    <header class="community-view-heading"><p>个人</p><h1>${escapeCommunityText(name)}的观鸟页</h1><span>${currentUser ? "管理你的公开笔记和互动。" : "登录后可管理你的笔记和互动。"}</span></header>
    <section class="community-person-card"><strong>${Number(communityWorkspaceStats?.posts ?? ownPosts.length)}</strong><span>已发布笔记</span><span>${Number(communityWorkspaceStats?.followers) || 0} 位粉丝 · 关注 ${Number(communityWorkspaceStats?.following) || 0} 人</span><a class="secondary-btn link-btn" href="${escapeCommunityText(currentUser ? "./community.html?view=publish" : getLoginUrl())}">${currentUser ? "写一条笔记" : "登录"}</a></section>
    <div class="community-note-grid">${ownPosts.length ? ownPosts.map(renderCommunityNoteCard).join("") : `<div class="community-empty-state"><h2>还没有公开笔记</h2><p>从一次观察开始，留下你的观鸟记录。</p></div>`}</div>
  `;
}

function renderCommunityWorkspace() {
  const panel = document.querySelector("[data-community-view-panel]");
  if (!panel) return;
  const view = getCommunityWorkspaceView();
  document.body.dataset.communityView = view;
  let activeRailLink = null;
  document.querySelectorAll("[data-community-view-link]").forEach((link) => {
    const active = link.dataset.communityViewLink === view;
    link.classList.toggle("is-active", active);
    link.setAttribute("aria-current", active ? "page" : "false");
    if (active) activeRailLink = link;
    if (link.dataset.communityViewLink === "moderation") {
      link.hidden = !canUseModerationWorkspace();
    }
  });
  const rail = activeRailLink?.closest(".community-rail");
  if (rail && activeRailLink) {
    const linkStart = activeRailLink.offsetLeft;
    const linkEnd = linkStart + activeRailLink.offsetWidth;
    if (linkStart < rail.scrollLeft) rail.scrollLeft = linkStart;
    else if (linkEnd > rail.scrollLeft + rail.clientWidth) rail.scrollLeft = linkEnd - rail.clientWidth;
  }
  panel.innerHTML = view === "recommended" || view === "following"
    ? renderCommunityFeedView(view)
    : view === "publish" ? renderCommunityPublishView()
    : view === "personal" ? renderCommunityPersonalView()
    : view === "moderation" ? renderCommunityModerationView()
    : renderCommunityMessagesView();
  bindCommunityWorkspaceView();
  applyRuntimeCapabilityControls();
}

function renderCommunityMediaPreview(file) {
  const preview = document.querySelector("#communityMediaPreview");
  if (!preview) return;
  if (communityWorkspaceMediaUrl) URL.revokeObjectURL(communityWorkspaceMediaUrl);
  communityWorkspaceMediaUrl = file ? URL.createObjectURL(file) : "";
  if (!file) {
    preview.hidden = true;
    preview.innerHTML = "";
    return;
  }
  const isVideo = file.type.startsWith("video/");
  preview.hidden = false;
  preview.innerHTML = `${isVideo ? `<video controls src="${communityWorkspaceMediaUrl}"></video>` : `<img src="${communityWorkspaceMediaUrl}" alt="待发布图片" />`}<span>${escapeCommunityText(file.name)}</span>`;
}

function readCommunityMedia(file) {
  if (!file) return Promise.resolve(null);
  const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  const videoTypes = new Set(["video/mp4", "video/webm"]);
  const isImage = imageTypes.has(file.type);
  const isVideo = videoTypes.has(file.type);
  if (!isImage && !isVideo) {
    return Promise.reject(new Error("请选择 JPG、PNG、WebP、MP4 或 WebM 文件。"));
  }
  if (isImage && !/\.(?:jpe?g|png|webp)$/i.test(file.name || "")) {
    return Promise.reject(new Error("图片扩展名必须是 JPG、JPEG、PNG 或 WebP。"));
  }
  if (isVideo && !/\.(?:mp4|webm)$/i.test(file.name || "")) {
    return Promise.reject(new Error("视频扩展名必须是 MP4 或 WebM。"));
  }
  if (isImage && file.size > getCommunityUploadLimit("image")) {
    return Promise.reject(new Error("图片请控制在 1 MiB 以内。"));
  }
  if (isVideo && file.size > getCommunityUploadLimit("video")) {
    return Promise.reject(new Error("视频请控制在 8 MiB 以内。"));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(
      isVideo
        ? { videoDataUrl: String(reader.result || ""), videoName: file.name }
        : { imageDataUrl: String(reader.result || ""), imageName: file.name }
    );
    reader.onerror = () => reject(new Error("媒体文件读取失败，请重新选择。"));
    reader.readAsDataURL(file);
  });
}

function getCommunityComposerFields() {
  return {
    title: document.querySelector("#communityComposerTitle")?.value.trim() || "",
    locationText: document.querySelector("#communityComposerLocation")?.value.trim() || "",
    body: document.querySelector("#communityComposerBody")?.value.trim() || "",
    bird: "观鸟笔记",
    visibility: document.querySelector("#communityComposerVisibility")?.value || "public",
  };
}

function communityDraftMatches(draft, fields) {
  return Boolean(draft)
    && ["title", "body", "bird", "locationText", "visibility"]
      .every((field) => String(draft[field] || "") === String(fields[field] || ""));
}

async function persistCommunityCloudDraft(fields) {
  if (communityDraftMatches(communityWorkspaceDraft, fields)) return communityWorkspaceDraft;
  communityWorkspacePublishKey = "";
  communityWorkspaceDraft = communityWorkspaceDraft?.id
    ? await communityApi.updateDraft(
      communityWorkspaceDraft.id,
      communityWorkspaceDraft.version,
      fields
    )
    : await communityApi.createDraft(fields);
  return communityWorkspaceDraft;
}

async function saveCommunityDraft() {
  const message = document.querySelector("#communityComposerMessage");
  if (!currentUser) {
    if (message) message.textContent = "登录后才能保存个人草稿。";
    return;
  }
  const fields = getCommunityComposerFields();
  if (isCapabilityEnabled("cloudDrafts")) {
    if (message) message.textContent = "正在保存云草稿...";
    try {
      await persistCommunityCloudDraft(fields);
      if (message) message.textContent = "云草稿已保存，可在其他设备继续编辑。媒体文件请在发布前重新选择。";
    } catch (error) {
      if (message) message.textContent = getCommunityMutationMessage(error, "云草稿保存失败，请稍后重试。");
    }
    return;
  }
  const draftKey = getCommunityDraftKey();
  if (!draftKey) {
    const message = document.querySelector("#communityComposerMessage");
    if (message) message.textContent = "登录后才能在当前浏览器保存个人草稿。";
    return;
  }
  try {
    window.localStorage.setItem(draftKey, JSON.stringify({
      title: fields.title,
      location: fields.locationText,
      body: fields.body,
    }));
    if (message) message.textContent = "草稿已保存在当前浏览器。媒体文件请在发布前重新选择。";
  } catch {
    if (message) message.textContent = "草稿保存失败，请检查浏览器存储权限。";
  }
}

function bindCommunityWorkspaceView() {
  const mediaInput = document.querySelector("#communityMedia");
  mediaInput?.addEventListener("change", () => renderCommunityMediaPreview(mediaInput.files?.[0] || null));
  document.querySelector("[data-community-save-draft]")?.addEventListener("click", saveCommunityDraft);
  document.querySelector("#communityComposer")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.querySelector("#communityComposerMessage");
    if (!isCapabilityEnabled("communityPublish")) {
      message.textContent = getCapabilityDisabledReason("communityPublish");
      applyRuntimeCapabilityControls();
      return;
    }
    if (!currentUser) {
      window.location.assign(getLoginUrl());
      return;
    }
    const fields = getCommunityComposerFields();
    const { title, body } = fields;
    const submit = event.currentTarget.querySelector('[type="submit"]');
    if (!title || !body) {
      message.textContent = !title ? "请填写标题。" : "请写下正文内容。";
      return;
    }
    if (body.length > POST_BODY_MAX_LENGTH) {
      message.textContent = `正文超过 ${POST_BODY_MAX_LENGTH} 字，请缩短后再发布。`;
      return;
    }
    submit.disabled = true;
    message.textContent = "正在发布...";
    try {
      const media = await readCommunityMedia(mediaInput?.files?.[0]);
      let newPost;
      if (isCapabilityEnabled("cloudDrafts")) {
        const draft = await persistCommunityCloudDraft(fields);
        if (!communityWorkspacePublishKey) {
          communityWorkspacePublishKey = window.crypto?.randomUUID
            ? `publish-${window.crypto.randomUUID()}`
            : `publish-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        }
        newPost = await communityApi.publishDraft(
          draft.id,
          draft.version,
          communityWorkspacePublishKey,
          media || {}
        );
        communityWorkspaceDraft = null;
        communityWorkspacePublishKey = "";
      } else {
        newPost = await communityApi.create({ ...fields, ...(media || {}) });
      }
      communityWorkspacePosts.unshift(newPost);
      const draftKey = getCommunityDraftKey();
      if (draftKey) window.localStorage.removeItem(draftKey);
      window.history.replaceState({}, "", "./community.html?view=personal");
      renderCommunityWorkspace();
    } catch (error) {
      message.textContent = getCommunityMutationMessage(error, "发布失败，请稍后重试。");
    } finally {
      submit.disabled = !isCapabilityEnabled("communityPublish");
    }
  });
  document.querySelectorAll("[data-workspace-like]").forEach((button) => {
    button.addEventListener("click", () => toggleCommunityWorkspaceLike(button.dataset.workspaceLike, button));
  });
  document.querySelectorAll("[data-workspace-follow]").forEach((button) => {
    button.addEventListener("click", () => toggleCommunityWorkspaceFollow(button.dataset.workspaceFollow, button));
  });
  document.querySelectorAll("[data-workspace-report]").forEach((form) => {
    form.addEventListener("submit", (event) => submitCommunityReport(event.currentTarget, event));
  });
  document.querySelectorAll("[data-community-notification-read]").forEach((button) => {
    button.addEventListener("click", () => markCommunityNotificationRead(button.dataset.communityNotificationRead, button));
  });
  document.querySelector("[data-community-notifications-read-all]")?.addEventListener("click", markAllCommunityNotificationsRead);
  document.querySelectorAll("[data-moderation-detail]").forEach((button) => {
    button.addEventListener("click", () => loadModerationCaseDetail(button.dataset.moderationDetail, button));
  });
  document.querySelectorAll("[data-moderation-decision]").forEach((button) => {
    button.addEventListener("click", () => submitModerationDecision(button.dataset.caseId, button.dataset.moderationDecision, button));
  });
  document.querySelectorAll("[data-moderation-refresh]").forEach((button) => {
    button.addEventListener("click", () => loadModerationQueue(button));
  });
}

async function submitCommunityReport(form, event) {
  event?.preventDefault();
  if (!form || !isCapabilityEnabled("contentReporting") || !requireLoginForAction()) return;
  const postId = form.dataset.workspaceReport;
  const reason = form.elements.reason?.value || "other";
  const detail = form.elements.detail?.value.trim() || "";
  const submit = form.querySelector('[type="submit"]');
  const message = form.querySelector("[data-workspace-report-message]");
  if (submit) submit.disabled = true;
  if (message) message.textContent = "正在提交举报...";
  try {
    await communityApi.reportPost(postId, reason, detail);
    form.querySelectorAll("select, textarea, button").forEach((control) => { control.disabled = true; });
    if (message) message.textContent = "举报已提交，审核员将根据事实处理。";
  } catch (error) {
    if (submit) submit.disabled = false;
    if (message) message.textContent = getCommunityMutationMessage(error, "举报提交失败，请稍后重试。");
  }
}

async function loadModerationCaseDetail(caseId, button) {
  if (!caseId || button?.disabled) return;
  if (button) button.disabled = true;
  try {
    const detail = await communityApi.getModerationCase(caseId);
    communityWorkspaceModerationDetails.set(caseId, detail);
    renderCommunityWorkspace();
  } catch (error) {
    if (button) button.disabled = false;
    window.alert(getCommunityMutationMessage(error, "审核详情加载失败，请稍后重试。"));
  }
}

async function submitModerationDecision(caseId, decision, button) {
  if (!caseId || !decision || button?.disabled) return;
  const reasonInput = document.querySelector(`[data-moderation-reason="${CSS.escape(caseId)}"]`);
  const message = document.querySelector(`[data-moderation-message="${CSS.escape(caseId)}"]`);
  const reason = reasonInput?.value.trim() || "";
  if (reason.length < 3) {
    if (message) message.textContent = "请填写至少 3 个字符的事实依据。";
    reasonInput?.focus();
    return;
  }
  button.disabled = true;
  if (message) message.textContent = "正在提交审核决定...";
  try {
    const updated = await communityApi.decideModerationCase(caseId, decision, reason);
    communityWorkspaceModerationCases = communityWorkspaceModerationCases.map((item) => (
      item.id === caseId ? updated : item
    ));
    communityWorkspaceModerationDetails.set(caseId, updated);
    renderCommunityWorkspace();
  } catch (error) {
    button.disabled = false;
    if (message) message.textContent = getCommunityMutationMessage(error, "审核决定提交失败，请稍后重试。");
  }
}

async function loadModerationQueue(button) {
  if (button) button.disabled = true;
  communityWorkspaceModerationState = "loading";
  renderCommunityWorkspace();
  try {
    const result = await communityApi.listModerationCases({ queue: "reported", status: "active", limit: 50 });
    communityWorkspaceModerationCases = result.cases || [];
    communityWorkspaceModerationDetails = new Map();
    communityWorkspaceModerationState = "ready";
    communityWorkspaceModerationMessage = "";
  } catch (error) {
    communityWorkspaceModerationState = "error";
    communityWorkspaceModerationMessage = withRequestId(error?.message || "审核队列加载失败。", error);
  }
  renderCommunityWorkspace();
}

async function markCommunityNotificationRead(notificationId, button) {
  if (!notificationId || button?.disabled) return;
  if (button) button.disabled = true;
  try {
    const result = await communityApi.markNotificationRead(notificationId);
    communityWorkspaceNotifications = communityWorkspaceNotifications.map((notification) => (
      notification.id === notificationId ? { ...notification, readAt: result?.readAt || new Date().toISOString() } : notification
    ));
    renderCommunityWorkspace();
  } catch (error) {
    if (button) button.disabled = false;
    window.alert(getCommunityMutationMessage(error, "消息状态更新失败，请稍后重试。"));
  }
}

async function markAllCommunityNotificationsRead() {
  try {
    await communityApi.markAllNotificationsRead();
    const readAt = new Date().toISOString();
    communityWorkspaceNotifications = communityWorkspaceNotifications.map((notification) => ({
      ...notification,
      readAt: notification.readAt || readAt,
    }));
    renderCommunityWorkspace();
  } catch (error) {
    window.alert(getCommunityMutationMessage(error, "消息状态更新失败，请稍后重试。"));
  }
}

async function toggleCommunityWorkspaceLike(postId, button) {
  const post = communityWorkspacePosts.find((item) => item.id === postId);
  if (!post?.createdAt || button.disabled) return;
  if (!isCapabilityEnabled("canonicalLike")) {
    applyRuntimeCapabilityControls();
    return;
  }
  if (!requireLoginForAction()) return;

  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    const currentlyLiked = post.viewerHasLiked === true || post.feedback?.helpful?.selected === true;
    const updatedPost = await communityApi.setLike(postId, !currentlyLiked);
    const postIndex = communityWorkspacePosts.findIndex((item) => item.id === postId);
    if (postIndex >= 0) {
      communityWorkspacePosts.splice(postIndex, 1, updatedPost);
    }
    renderCommunityWorkspace();
  } catch (error) {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    window.alert(getCommunityMutationMessage(error, "点赞失败，请稍后重试。"));
    if (error?.status === 401) {
      clearAuthState();
    }
  }
}

async function toggleCommunityWorkspaceFollow(authorId, button) {
  if (!authorId || button.disabled || !requireLoginForAction()) return;
  const currentlyFollowing = button.getAttribute("aria-pressed") === "true";
  button.disabled = true;
  try {
    const profile = await communityApi.setFollow(authorId, !currentlyFollowing);
    communityWorkspacePosts = communityWorkspacePosts
      .map((post) => post.authorId === authorId
        ? { ...post, viewerFollowsAuthor: profile?.viewer?.isFollowing === true }
        : post)
      .filter((post) => getCommunityWorkspaceView() !== "following" || post.viewerFollowsAuthor);
    renderCommunityWorkspace();
  } catch (error) {
    button.disabled = false;
    window.alert(getCommunityMutationMessage(error, "关注操作失败，请稍后重试。"));
  }
}

async function loadCommunityWorkspaceData() {
  if (page !== "community" || !document.querySelector("[data-community-workspace]")) return;
  const view = getCommunityWorkspaceView();
  if (currentUser && !communityWorkspaceRolesLoaded && isCapabilityEnabled("moderationAdmin")) {
    try {
      communityWorkspaceRoles = await communityApi.getMyRoles();
    } catch {
      communityWorkspaceRoles = [];
    }
    communityWorkspaceRolesLoaded = true;
  } else if (!currentUser || !isCapabilityEnabled("moderationAdmin")) {
    communityWorkspaceRoles = [];
    communityWorkspaceRolesLoaded = true;
  }
  if (view === "moderation") {
    renderCommunityWorkspace();
    if (canUseModerationWorkspace()) await loadModerationQueue();
    return;
  }
  communityWorkspaceLoadState = "loading";
  if (view === "messages") communityWorkspaceNotificationState = "loading";
  renderCommunityWorkspace();
  const request = view === "personal"
    ? communityApi.listMyPosts({ limit: 30 })
    : view === "messages" || view === "publish"
      ? communityApi.listFeed("recommended", { limit: 3 })
      : communityApi.listFeed(view, { limit: 30 });
  request.then((result) => {
    communityWorkspacePosts = result.posts || [];
    communityWorkspaceLoadState = "ready";
    communityWorkspaceLoadMessage = "";
    renderCommunityWorkspace();
  }).catch((error) => {
    communityWorkspaceLoadState = "error";
    communityWorkspaceLoadMessage = withRequestId(error?.message || "社区内容加载失败，请稍后重试。", error);
    renderCommunityWorkspace();
  });
  if (view === "personal") {
    communityApi.getMyStats().then((stats) => {
      communityWorkspaceStats = stats;
      renderCommunityWorkspace();
    }).catch(() => {});
  }
  if (view === "publish" && currentUser && isCapabilityEnabled("cloudDrafts")) {
    communityApi.listDrafts({ limit: 1 }).then((result) => {
      communityWorkspaceDraft = result.drafts?.[0] || null;
      renderCommunityWorkspace();
    }).catch((error) => {
      communityWorkspaceLoadMessage = withRequestId(error?.message || "云草稿加载失败。", error);
      renderCommunityWorkspace();
    });
  }
  if (view === "messages" && currentUser && isCapabilityEnabled("notifications")) {
    communityApi.listNotifications({ limit: 30 }).then((result) => {
      communityWorkspaceNotifications = result.notifications || [];
      communityWorkspaceNotificationState = "ready";
      communityWorkspaceNotificationMessage = "";
      renderCommunityWorkspace();
    }).catch((error) => {
      communityWorkspaceNotificationState = "error";
      communityWorkspaceNotificationMessage = withRequestId(error?.message || "消息加载失败，请稍后重试。", error);
      renderCommunityWorkspace();
    });
  } else if (view === "messages") {
    communityWorkspaceNotificationState = "ready";
  }
}

function initCommunityWorkspace() {
  if (page !== "community" || !document.querySelector("[data-community-workspace]")) return;
  renderCommunityWorkspace();
  window.addEventListener("popstate", loadCommunityWorkspaceData);
}

initCommunityWorkspace();

let profileAvatarDataUrl = "";

function setProfileCenterMessage(selector, text = "") {
  const target = document.querySelector(selector);
  if (target) target.textContent = text;
}

function renderProfileAvatarPreview() {
  const name = currentUser?.nickname || "我的观鸟档案";
  const avatar = profileAvatarDataUrl || currentUser?.avatarUrl;
  document.querySelectorAll("[data-profile-avatar], [data-profile-avatar-preview]").forEach((node) => {
    node.textContent = avatar ? "" : name.slice(0, 1).toUpperCase();
    node.style.backgroundImage = avatar ? `url("${avatar}")` : "";
    node.classList.toggle("has-image", Boolean(avatar));
  });
}

function renderProfileCenter() {
  if (page !== "profile") return;
  const signedIn = Boolean(currentUser);
  const loginState = document.querySelector("[data-profile-login-state]");
  const settings = document.querySelector("[data-profile-settings]");
  if (loginState) loginState.hidden = signedIn;
  if (settings) settings.hidden = !signedIn;
  const name = currentUser?.nickname || "我的观鸟档案";
  const email = currentUser?.email || "登录后可编辑个人资料。";
  document.querySelectorAll("[data-profile-center-name]").forEach((node) => { node.textContent = name; });
  document.querySelectorAll("[data-profile-center-email]").forEach((node) => { node.textContent = email; });
  renderProfileAvatarPreview();
  if (!signedIn) return;
  const nickname = document.querySelector("#profileNicknameInput");
  const bio = document.querySelector("#profileBioInput");
  const gender = document.querySelector("#profileGenderInput");
  const age = document.querySelector("#profileAgeInput");
  const publicProfile = document.querySelector("#profilePublicInput");
  const emailNotifications = document.querySelector("#profileEmailInput");
  if (nickname) nickname.value = currentUser.nickname || "";
  if (bio) bio.value = currentUser.bio || "";
  if (gender) gender.value = currentUser.gender || "";
  if (age) age.value = currentUser.age || "";
  if (publicProfile) publicProfile.checked = currentUser.publicProfile !== false;
  if (emailNotifications) emailNotifications.checked = currentUser.emailNotifications !== false;
  applyRuntimeCapabilityControls();
}

function readProfileAvatar(file) {
  if (!file) return Promise.resolve("");
  if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type) || file.size > 600 * 1024) {
    return Promise.reject(new Error("头像请使用不超过 600KB 的 JPG、PNG 或 WebP 图片。"));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("头像读取失败，请重新选择。"));
    reader.readAsDataURL(file);
  });
}

function getBasicProfilePayload() {
  const ageValue = document.querySelector("#profileAgeInput")?.value || "";
  const payload = {
    nickname: document.querySelector("#profileNicknameInput")?.value.trim() || "",
    bio: document.querySelector("#profileBioInput")?.value.trim() || "",
    gender: document.querySelector("#profileGenderInput")?.value || "",
    age: ageValue ? Number(ageValue) : null,
  };
  if (profileAvatarDataUrl) payload.avatarUrl = profileAvatarDataUrl;
  return payload;
}

function getProfilePreferencePayload() {
  return {
    publicProfile: Boolean(document.querySelector("#profilePublicInput")?.checked),
  };
}

async function saveProfileCenter(messageSelector, payload, options = {}) {
  if (!currentUser) return;
  const data = await authRequest("/api/auth/profile", { method: "PATCH", body: payload });
  rememberAuthUser(data.user);
  if (options.clearAvatarSelection) profileAvatarDataUrl = "";
  renderProfileCenter();
  setProfileCenterMessage(messageSelector, "已保存。");
}

function initProfileCenter() {
  if (page !== "profile" || !document.querySelector("[data-profile-center]")) return;
  renderProfileCenter();
  syncAuthState().then(renderProfileCenter).catch(renderProfileCenter);
  const avatarInput = document.querySelector("#profileAvatarInput");
  avatarInput?.addEventListener("change", async () => {
    try {
      profileAvatarDataUrl = await readProfileAvatar(avatarInput.files?.[0]);
      renderProfileAvatarPreview();
      setProfileCenterMessage("[data-profile-message]", "头像已选好，点击保存资料后生效。");
    } catch (error) {
      avatarInput.value = "";
      setProfileCenterMessage("[data-profile-message]", error.message);
    }
  });
  document.querySelector("#profileSettingsForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await saveProfileCenter("[data-profile-message]", getBasicProfilePayload(), { clearAvatarSelection: true });
    } catch (error) {
      setProfileCenterMessage("[data-profile-message]", translateAuthMessage(error.message, "资料保存失败，请稍后重试。"));
    }
  });
  document.querySelector("[data-profile-save-preferences]")?.addEventListener("click", async () => {
    try {
      await saveProfileCenter("[data-profile-preference-message]", getProfilePreferencePayload());
    } catch (error) {
      setProfileCenterMessage("[data-profile-preference-message]", translateAuthMessage(error.message, "设置保存失败，请稍后重试。"));
    }
  });
  document.querySelector("[data-profile-delete]")?.addEventListener("click", async () => {
    if (!isCapabilityEnabled("accountDeletion")) {
      setProfileCenterMessage("[data-profile-account-capability]", getCapabilityDisabledReason("accountDeletion"));
      applyRuntimeCapabilityControls();
      return;
    }
    const password = document.querySelector("#profileDeletePassword")?.value || "";
    const confirmation = document.querySelector("#profileDeleteConfirmation")?.value || "";
    if (!password || confirmation !== "注销我的账号") {
      setProfileCenterMessage("[data-profile-delete-message]", "请输入当前密码，并准确输入“注销我的账号”。");
      return;
    }
    try {
      await authRequest("/api/auth/account", { method: "DELETE", body: { password, confirmation } });
      clearAuthState();
      window.location.replace("./index.html#home");
    } catch (error) {
      setProfileCenterMessage("[data-profile-delete-message]", translateAuthMessage(error.message, "注销失败，请稍后重试。"));
    }
  });
}

initProfileCenter();
