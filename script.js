const page = document.body.dataset.page || "home";

const STORAGE_KEYS = {
  loggedIn: "birdoraLoggedIn",
  authUser: "birdora-auth-user",
  registeredUsers: "birdora-registered-users",
  userPosts: "birdora-user-posts",
  comments: "birdora-post-comments",
  communityTab: "birdora-community-tab",
};

const DEV_SKIP_AUTH = true;
// TODO: Production mode should enable authentication

const AUTH_PAGES = new Set(["home", "community"]);

const birds = [
  {
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
const upload = document.querySelector("#birdUpload");
const preview = document.querySelector("#previewImage");
const uploadZone = document.querySelector(".upload-zone");
const confidenceText = document.querySelector("#confidenceText");
const resultName = document.querySelector("#resultName");
const resultMeta = document.querySelector("#resultMeta");
const resultFeature = document.querySelector("#resultFeature");
const modelDetail = document.querySelector("#modelDetail");
const feed = document.querySelector("#feed");
const communityFeed = document.querySelector("#communityFeed");
const postForm = document.querySelector("#postForm");
const postTitle = document.querySelector("#postTitle");
const postBody = document.querySelector("#postBody");
const useDetected = document.querySelector("#useDetected");
const communityTabs = document.querySelectorAll("[data-community-tab]");
const logoutButtons = document.querySelectorAll("[data-logout]");
const authForms = document.querySelectorAll("[data-auth-form]");
const loginBtn = document.querySelector("#loginBtn");

const expandedComments = new Set();

let detectedBird = birds[0];
let classifierPromise;
let userPosts = [];
let commentsByPostId = {};
let activeCommunityTab = "recommended";
let currentUser = null;

const recognitionRules = [
  { oseaIndex: 3334, bird: "翠鸟", cn: "普通翠鸟", en: "Common Kingfisher" },
  { oseaIndex: 861, bird: "白鹭", cn: "白鹭", en: "Little Egret" },
  { oseaIndex: 7201, bird: "白头鹎", cn: "白头鹎", en: "Light-vented Bulbul" },
  { oseaIndex: 1892, bird: "珠颈斑鸠", cn: "珠颈斑鸠", en: "Spotted Dove" },
  { oseaIndex: 6798, bird: "灰喜鹊", cn: "灰喜鹊", en: "Azure-winged Magpie" },
  { oseaIndex: 6803, bird: "红嘴蓝鹊", cn: "红嘴蓝鹊", en: "Red-billed Blue Magpie" },
  { oseaIndex: 1388, bird: "黑水鸡", cn: "黑水鸡", en: "Common Moorhen" },
  { oseaIndex: 6452, bird: "棕背伯劳", cn: "棕背伯劳", en: "Long-tailed Shrike" },
  { oseaIndex: 7381, bird: "家燕", cn: "家燕", en: "Barn Swallow" },
  { oseaIndex: 9380, bird: "麻雀", cn: "麻雀", en: "Eurasian Tree Sparrow" },
];

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

function getAuthUser() {
  return safeParseStorage(STORAGE_KEYS.authUser, null);
}

function isLoggedIn() {
  return window.localStorage.getItem(STORAGE_KEYS.loggedIn) === "true";
}

function getRegisteredUsers() {
  return safeParseStorage(STORAGE_KEYS.registeredUsers, []);
}

function getValidatedAuthUser() {
  if (!isLoggedIn()) {
    return null;
  }

  const authUser = getAuthUser();
  return authUser || { email: "dev@birdora.local", nickname: "开发者" };
}

function requireAuth() {
  currentUser = getValidatedAuthUser() || { email: "dev@birdora.local", nickname: "开发者" };
  // TODO: Production mode should enable authentication
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

  const text = field.value.trim();
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

function initCommunityTabs() {
  if (!communityTabs.length) return;

  activeCommunityTab = window.localStorage.getItem(STORAGE_KEYS.communityTab) || "recommended";

  communityTabs.forEach((tab) => {
    const active = tab.dataset.communityTab === activeCommunityTab;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });

  communityTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activeCommunityTab = tab.dataset.communityTab;
      window.localStorage.setItem(STORAGE_KEYS.communityTab, activeCommunityTab);
      initCommunityTabs();
      renderCommunityFeed();
    });
  });
}

function initAuthForms() {
  if (!authForms.length) return;

  authForms.forEach((form) => {
    const mode = form.dataset.authForm;
    const message = form.querySelector("[data-auth-message]");

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      message.textContent = "";

      if (mode === "login") {
        window.location.href = "./index.html";
        return;
      }

      const emailField = form.querySelector('[name="email"]');
      const passwordField = form.querySelector('[name="password"]');
      if (!emailField || !passwordField) return;

      if (!form.reportValidity()) {
        return;
      }

      const email = emailField.value.trim().toLowerCase();
      const password = passwordField.value.trim();

      if (!email || !password) {
        message.textContent = "请先填写邮箱和密码。";
        return;
      }

      if (mode === "register") {
        const nickname = form.querySelector('[name="nickname"]').value.trim();
        const agreed = form.querySelector('[name="agree"]').checked;
        if (!nickname) {
          message.textContent = "请先填写昵称。";
          return;
        }
        if (!agreed) {
          message.textContent = "请先勾选同意《用户协议》和《隐私政策》。";
          return;
        }

        const users = getRegisteredUsers();
        if (users.some((user) => user.email === email)) {
          message.textContent = "这个邮箱已经注册过了，请直接登录。";
          return;
        }

        const newUser = { email, password, nickname };
        saveStorage(STORAGE_KEYS.registeredUsers, [...users, newUser]);
        window.localStorage.setItem(STORAGE_KEYS.loggedIn, "true");
        saveStorage(STORAGE_KEYS.authUser, { email, nickname });
        window.location.replace("./index.html");
        return;
      }

      const users = getRegisteredUsers();
      const matchedUser = users.find((user) => user.email === email && user.password === password);
      if (!matchedUser) {
        message.textContent = "邮箱或密码不正确，请检查后重试。";
        return;
      }

      saveStorage(STORAGE_KEYS.authUser, {
        email: matchedUser.email,
        nickname: matchedUser.nickname,
      });
      window.localStorage.setItem(STORAGE_KEYS.loggedIn, "true");
      window.location.replace("./index.html");
    });
  });
}

function initDevLoginButton() {
  if (!loginBtn) return;

  loginBtn.addEventListener("click", function (event) {
    event.preventDefault();
    window.location.href = "./index.html";
  });
}

function logout() {
  window.localStorage.removeItem(STORAGE_KEYS.loggedIn);
  window.localStorage.removeItem(STORAGE_KEYS.authUser);
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

function updateModelReadiness() {
  if (!resultMeta || !modelDetail) return;

  window.setTimeout(() => {
    if (window.ort) {
      resultMeta.textContent = "OSEA 模型运行器已就绪，首次识别会加载 26MB 模型";
      modelDetail.textContent =
        "已接入 sun-jiao/osea_mobile 的 bird_model.onnx，当前结果限定为 10 个支持鸟种。";
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

function softmax(values) {
  const max = Math.max(...values);
  const exps = values.map((value) => Math.exp(value - max));
  const sum = exps.reduce((total, value) => total + value, 0);
  return exps.map((value) => value / sum);
}

function topSupportedBird(logits) {
  const supportedScores = recognitionRules.map((rule) => ({
    ...rule,
    raw: logits[rule.oseaIndex],
  }));
  const selectedProbabilities = softmax(supportedScores.map((item) => item.raw));
  return supportedScores
    .map((item, index) => ({ ...item, selectedProbability: selectedProbabilities[index] }))
    .sort((a, b) => b.selectedProbability - a.selectedProbability)[0];
}

async function classifyImageElement(imageElement) {
  const classifier = await getClassifier();
  const tensor = imageToOseaTensor(imageElement);
  const feeds = { [classifier.inputNames[0]]: tensor };
  const outputMap = await classifier.run(feeds);
  const output = outputMap[classifier.outputNames[0]];
  const logits = Array.from(output.data);
  return topSupportedBird(logits);
}

function renderBirds() {
  if (!birdGrid || !birdSearch) return;

  const query = birdSearch.value.trim().toLowerCase();
  const filtered = birds.filter((bird) => {
    return (
      bird.name.toLowerCase().includes(query) ||
      bird.latin.toLowerCase().includes(query) ||
      bird.feature.toLowerCase().includes(query) ||
      bird.clue.toLowerCase().includes(query) ||
      bird.place.toLowerCase().includes(query) ||
      bird.food.toLowerCase().includes(query)
    );
  });

  if (!filtered.length) {
    birdGrid.classList.add("is-empty");
    birdGrid.innerHTML =
      `<article class="bird-card"><div><h3>没有找到鸟种</h3><p>可以换一个关键词再试试。</p></div></article>`;
    return;
  }

  birdGrid.classList.remove("is-empty");

  const cardsMarkup = filtered
    .map(
      (bird) => `
        <article class="bird-card">
          <figure class="bird-photo">
            <img src="${bird.image}" alt="${bird.name}照片" loading="lazy" />
            <figcaption>图片来源 Wikimedia</figcaption>
          </figure>
          <div>
            <h3>${bird.name}</h3>
            <p>${bird.latin}</p>
            <p>${bird.feature}</p>
            <p class="bird-clue">${bird.clue}</p>
            <div class="tag-row">
              <span>${bird.place}</span>
              <span>${bird.food}</span>
            </div>
            <a class="source-link" href="${bird.source}" target="_blank" rel="noreferrer">查看来源</a>
          </div>
        </article>
      `
    )
    .join("");

  birdGrid.innerHTML = `
    <div class="bird-marquee">
      <div class="bird-track">
        ${cardsMarkup}
      </div>
      <div class="bird-track" aria-hidden="true">
        ${cardsMarkup}
      </div>
    </div>
  `;
}

function initAtlasSearch() {
  if (!birdSearch) return;
  birdSearch.addEventListener("input", renderBirds);
}

function setResult(bird, confidence = 92, detail = "模型已匹配到图鉴中的常见鸟种。") {
  if (!confidenceText || !resultName || !resultMeta || !resultFeature || !modelDetail) return;

  detectedBird = bird;
  confidenceText.textContent = `${confidence}%`;
  resultName.textContent = bird.name;
  resultMeta.textContent = `${bird.latin} · ${bird.place}`;
  resultFeature.textContent = bird.feature;
  modelDetail.textContent = detail;
  document.querySelector(".confidence-ring").style.background = `
    radial-gradient(circle at center, #fff 55%, transparent 56%),
    conic-gradient(var(--green) 0 ${confidence}%, #e9f0ec ${confidence}% 100%)
  `;
}

function setPendingResult(text) {
  if (!confidenceText || !resultName || !resultMeta || !resultFeature || !modelDetail) return;

  confidenceText.textContent = "...";
  resultName.textContent = "正在识别";
  resultMeta.textContent = "AI 模型正在分析这张照片";
  resultFeature.textContent = "请稍等几秒，首次加载模型可能会更慢。";
  modelDetail.textContent = text;
}

function setUnknownResult(predictions) {
  if (!confidenceText || !resultName || !resultMeta || !resultFeature || !modelDetail) return;

  confidenceText.textContent = "--";
  resultName.textContent = "未确定鸟种";
  resultMeta.textContent = "建议换一张更清晰、主体更大的鸟类照片";
  resultFeature.textContent = "当前模型没有把照片稳定匹配到支持的 10 种鸟。";
  modelDetail.textContent = predictions || "模型没有返回可用结果。";
  document.querySelector(".confidence-ring").style.background = `
    radial-gradient(circle at center, #fff 55%, transparent 56%),
    conic-gradient(#9ba9a2 0 100%, #e9f0ec 100% 100%)
  `;
}

function initBirdRecognition() {
  if (!upload || !preview || !uploadZone) return;

  upload.addEventListener("change", async () => {
    const file = upload.files[0];
    if (!file) return;
    uploadZone.classList.add("has-image");
    setPendingResult("正在加载/运行 OSEA 鸟类识别模型...");

    try {
      const objectUrl = URL.createObjectURL(file);
      await new Promise((resolve, reject) => {
        preview.onload = resolve;
        preview.onerror = reject;
        preview.src = objectUrl;
      });

      const top = await classifyImageElement(preview);
      const bird = birds.find((item) => item.name === top.bird);
      if (!bird) {
        setUnknownResult(`识别到 ${top.cn}，但网站图鉴里还没有对应卡片。`);
        return;
      }

      const confidence = Math.round(Math.max(45, Math.min(98, top.selectedProbability * 100)));
      const detail = `OSEA 支持类别：${top.cn} / ${top.en}。当前演示只在 10 个鸟种中取最高分。`;
      setResult(bird, confidence, detail);
    } catch (error) {
      confidenceText.textContent = "!";
      resultName.textContent = "识别失败";
      resultMeta.textContent = "模型加载或图片读取失败";
      resultFeature.textContent = "请确认使用 http://localhost 或正式网址打开，而不是直接 file:// 打开。";
      modelDetail.textContent = error.message || "未知错误";
    }
  });
}

function initPublishing() {
  if (postForm && postTitle && postBody) {
    postForm.addEventListener("submit", (event) => {
      event.preventDefault();

      const newPost = {
        id: createPostId(),
        title: postTitle.value.trim(),
        body: postBody.value.trim(),
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
      postTitle.value = `今天观察到 ${detectedBird.name}`;
      postBody.value = `${detectedBird.name}，${detectedBird.feature} 观察地点可以补充为公园、湿地或校园。`;
      postBody.focus();
    });
  }

  const shareDetectedButton = document.querySelector("#shareDetected");
  if (shareDetectedButton) {
    shareDetectedButton.addEventListener("click", () => {
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
      document.querySelector("#community").scrollIntoView({ behavior: "smooth" });
    });
  }
}

function initScrollButtons() {
  document.querySelectorAll("[data-scroll]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector(button.dataset.scroll).scrollIntoView({ behavior: "smooth" });
    });
  });
}

if (!requireAuth()) {
  initAuthForms();
  initDevLoginButton();
} else {
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
        const top = await classifyImageElement(testImage);
        const bird = birds.find((item) => item.name === top.bird);
        if (!bird) throw new Error(`自测识别到 ${top.cn}，但图鉴没有对应卡片。`);
        const confidence = Math.round(Math.max(45, Math.min(98, top.selectedProbability * 100)));
        setResult(bird, confidence, `自测通过：OSEA 返回 ${top.cn} / ${top.en}。`);
      } catch (error) {
        confidenceText.textContent = "!";
        resultName.textContent = "OSEA 自测失败";
        resultMeta.textContent = "模型、WASM 或资源路径需要检查";
        resultFeature.textContent = "请使用本地服务器或正式网址访问，不要直接用 file:// 打开 OSEA 版本。";
        modelDetail.textContent = error.message || "未知错误";
      }
    }, 800);
  }
}
