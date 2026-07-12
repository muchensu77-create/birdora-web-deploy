const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const rootDir = path.resolve(__dirname, "..");
const rootScriptPath = path.join(rootDir, "script.js");
const publicScriptPath = path.join(rootDir, "public", "script.js");
const rootCommunityApiPath = path.join(rootDir, "community-api.js");
const postCardPath = path.join(rootDir, "community-post-card.js");
const syncScriptPath = path.join(rootDir, "scripts", "sync-public.js");
const capabilityConfigPath = path.join(rootDir, "app", "config", "capabilities.config.js");
const communityRoutesPath = path.join(rootDir, "app", "routes", "community-post.routes.js");

let passed = 0;

function check(label, callback) {
  try {
    callback();
    passed += 1;
    console.log(`PASS ${label}`);
  } catch (error) {
    error.message = `${label}: ${error.message}`;
    throw error;
  }
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function extractTopLevelFunction(source, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const marker = new RegExp(`(?:^|\\n)(?:async\\s+)?function\\s+${escapedName}\\s*\\(`, "m");
  const match = marker.exec(source);
  assert.ok(match, `missing function ${name}`);

  const start = match.index + (match[0].startsWith("\n") ? 1 : 0);
  const rest = source.slice(start + 1);
  const nextFunction = /\n(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/m.exec(rest);
  return nextFunction ? source.slice(start, start + 1 + nextFunction.index) : source.slice(start);
}

function extractObjectLiteral(source, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`const\\s+${escapedName}\\s*=\\s*Object\\.freeze\\(\\{([\\s\\S]*?)\\}\\);`).exec(source);
  assert.ok(match, `missing frozen object ${name}`);
  return match[1];
}

function extractSyncManifest(source) {
  const match = /const\s+publicFiles\s*=\s*\[([\s\S]*?)\];/.exec(source);
  assert.ok(match, "sync-public.js does not expose the publicFiles manifest");
  const files = Array.from(match[1].matchAll(/["']([^"']+)["']/g), (entry) => entry[1]);
  assert.ok(files.length > 0, "publicFiles manifest is empty");
  return files;
}

function assertFileBytesEqual(leftPath, rightPath) {
  assert.ok(fs.existsSync(leftPath), `missing source file ${path.relative(rootDir, leftPath)}`);
  assert.ok(fs.existsSync(rightPath), `missing public file ${path.relative(rootDir, rightPath)}`);
  assert.deepEqual(
    fs.readFileSync(rightPath),
    fs.readFileSync(leftPath),
    `${path.relative(rootDir, rightPath)} differs from its root source`
  );
}

const rootScript = readText(rootScriptPath);
const publicScript = readText(publicScriptPath);

check("root and public browser scripts parse", () => {
  new vm.Script(rootScript, { filename: rootScriptPath });
  new vm.Script(publicScript, { filename: publicScriptPath });
});

check("all sync-public manifest files are byte-for-byte synchronized", () => {
  const publicFiles = extractSyncManifest(readText(syncScriptPath));
  for (const criticalFile of ["script.js", "community.html", "profile.html"]) {
    assert.ok(publicFiles.includes(criticalFile), `${criticalFile} is missing from the sync manifest`);
  }
  for (const relativePath of publicFiles) {
    assertFileBytesEqual(
      path.join(rootDir, relativePath),
      path.join(rootDir, "public", relativePath)
    );
  }
});

check("community detail code has no removed demo-helper references", () => {
  const detailCode = [
    "findCommunityPost",
    "renderPostDetail",
    "openPostDetail",
    "loadDetailComments",
  ].map((functionName) => extractTopLevelFunction(rootScript, functionName)).join("\n");

  for (const identifier of ["getExamplePosts", "isExampleCommunityPost", "recommendedPosts"]) {
    assert.doesNotMatch(
      detailCode,
      new RegExp(`\\b${identifier}\\b`),
      `${identifier} remains in the post-detail path after its demo implementation was removed`
    );
  }
});

check("missing real post lookup returns null without a ReferenceError", () => {
  const findCommunityPostSource = extractTopLevelFunction(rootScript, "findCommunityPost");
  const context = vm.createContext({ communityPosts: [{ id: "real-post" }] });
  const result = vm.runInContext(
    `${findCommunityPostSource}\nfindCommunityPost("missing-post");`,
    context,
    { timeout: 1000 }
  );
  assert.equal(result, null);
});

check("community drafts use a stable per-user storage key", () => {
  assert.doesNotMatch(
    rootScript,
    /localStorage\.(?:get|set|remove)Item\(COMMUNITY_DRAFT_KEY(?:_PREFIX)?\b/,
    "community draft storage still uses one shared browser key"
  );

  const keyFunction = extractTopLevelFunction(rootScript, "getCommunityDraftKey");
  assert.match(keyFunction, /currentUser\?*\./, "draft key does not depend on the authenticated user");
  assert.match(keyFunction, /\bid\b/, "draft key does not use the stable user id");

  const prefixMatch = /const\s+COMMUNITY_DRAFT_KEY_PREFIX\s*=\s*(["'][^"']+["'])\s*;/.exec(rootScript);
  assert.ok(prefixMatch, "missing COMMUNITY_DRAFT_KEY_PREFIX");
  const evaluateKey = (currentUser) => vm.runInNewContext(
    `const COMMUNITY_DRAFT_KEY_PREFIX = ${prefixMatch[1]};\n` +
      `const currentUser = ${JSON.stringify(currentUser)};\n` +
      `${keyFunction}\ngetCommunityDraftKey();`,
    {},
    { timeout: 1000 }
  );

  const firstUserKey = evaluateKey({ id: "user-a", email: "same@example.com" });
  const secondUserKey = evaluateKey({ id: "user-b", email: "same@example.com" });
  assert.equal(evaluateKey(null), null, "anonymous sessions must not share a persisted draft key");
  assert.equal(firstUserKey, evaluateKey({ id: "user-a", email: "changed@example.com" }));
  assert.notEqual(firstUserKey, secondUserKey, "different users resolve to the same draft key");

  const draftFunctions = [
    extractTopLevelFunction(rootScript, "getCommunityDraft"),
    extractTopLevelFunction(rootScript, "saveCommunityDraft"),
    extractTopLevelFunction(rootScript, "bindCommunityWorkspaceView"),
  ].join("\n");
  assert.match(draftFunctions, /const\s+draftKey\s*=\s*getCommunityDraftKey\(\)/, "draft storage does not resolve the current user key");
  for (const method of ["getItem", "setItem", "removeItem"]) {
    assert.match(
      draftFunctions,
      new RegExp(`localStorage\\.${method}\\(draftKey`),
      `draft ${method} does not use the per-user draft key`
    );
  }
});

check("canonical workspace like and legacy feed like are independently fail-closed", () => {
  const safeDefaults = extractObjectLiteral(rootScript, "SAFE_CAPABILITY_DEFAULTS");
  assert.match(
    safeDefaults,
    /\bcommunityLegacyLike\s*:\s*false\b/,
    "communityLegacyLike must default to false"
  );
  assert.match(safeDefaults, /\bcanonicalLike\s*:\s*false\b/, "canonicalLike must default to false");

  const renderCard = extractTopLevelFunction(rootScript, "renderCommunityNoteCard");
  assert.match(renderCard, /isCapabilityEnabled\(["']canonicalLike["']\)/);

  const toggleLike = extractTopLevelFunction(rootScript, "toggleCommunityWorkspaceLike");
  const guardIndex = toggleLike.search(/isCapabilityEnabled\(["']canonicalLike["']\)/);
  const requestIndex = toggleLike.search(/communityApi\.setLike\s*\(/);
  assert.ok(guardIndex >= 0, "workspace like request has no canonicalLike capability check");
  assert.ok(requestIndex >= 0, "canonical workspace like request is missing");
  assert.ok(guardIndex < requestIndex, "like capability is checked after the mutation request");

  const oldFeedToggle = extractTopLevelFunction(rootScript, "togglePostReaction");
  const oldFeedGuardIndex = oldFeedToggle.search(/isCapabilityEnabled\(["']communityLegacyLike["']\)/);
  const oldFeedRequestIndex = oldFeedToggle.search(/communityApi\.react\s*\(/);
  assert.ok(oldFeedGuardIndex >= 0 && oldFeedGuardIndex < oldFeedRequestIndex, "old feed reaction request is not fail-closed");

  const postCard = readText(postCardPath);
  assert.match(postCard, /canReact\s*=\s*options\.canReact\s*===\s*true/, "post card reactions do not default to disabled");
  assert.match(postCard, /canInteract\s*&&\s*canReact\s*&&\s*!isEditing/, "post card renders reactions without the capability");
});

check("cloud draft publish and notifications use authenticated v1 APIs", () => {
  const apiSource = readText(rootCommunityApiPath);
  for (const route of [
    "/api/v1/drafts",
    "/api/v1/notifications",
    "/api/v1/notification-preferences",
  ]) {
    assert.match(apiSource, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(apiSource, /Idempotency-Key/, "draft publish omits idempotency key");
  const publishBinding = extractTopLevelFunction(rootScript, "bindCommunityWorkspaceView");
  assert.match(publishBinding, /communityApi\.publishDraft\s*\(/);
  assert.match(publishBinding, /isCapabilityEnabled\(["']cloudDrafts["']\)/);
  const messagesView = extractTopLevelFunction(rootScript, "renderCommunityMessagesView");
  assert.match(messagesView, /isCapabilityEnabled\(["']notifications["']\)/);
});

check("legacy like capability is explicitly enabled and route-guarded on the server", () => {
  const capabilityConfig = readText(capabilityConfigPath);
  const communityRoutes = readText(communityRoutesPath);
  assert.match(
    capabilityConfig,
    /communityLegacyLike\s*:\s*isExplicitlyEnabled\(process\.env\.COMMUNITY_LEGACY_LIKE_ENABLED\)/
  );
  assert.match(
    communityRoutes,
    /requireFeature\(["']communityLegacyLike["']/,
    "legacy reaction route is not guarded"
  );
});

console.log(`Frontend contracts complete: ${passed} checks passed.`);
