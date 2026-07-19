const COMMUNITY_IMAGE_MAX_BYTES = 1024 * 1024;
const COMMUNITY_VIDEO_MAX_BYTES = 8 * 1024 * 1024;

function isExplicitlyEnabled(value) {
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

const featureFlags = Object.freeze({
  accountDeletion: isExplicitlyEnabled(process.env.ACCOUNT_DELETION_ENABLED),
  communityPublish: isExplicitlyEnabled(process.env.COMMUNITY_PUBLISH_ENABLED),
  communityPostEdit: isExplicitlyEnabled(process.env.COMMUNITY_POST_EDIT_ENABLED),
  communityLegacyLike: isExplicitlyEnabled(process.env.COMMUNITY_LEGACY_LIKE_ENABLED),
  communityDemo: isExplicitlyEnabled(process.env.COMMUNITY_DEMO_ENABLED),
  socialFeedV1: true,
  canonicalLike: true,
  cloudDrafts: true,
  notifications: true,
  contentReporting: true,
  moderationAdmin: true,
  sse: false,
});

const mediaLimits = Object.freeze({
  communityImageBytes: COMMUNITY_IMAGE_MAX_BYTES,
  communityVideoBytes: COMMUNITY_VIDEO_MAX_BYTES,
});

const disabledReasonCopy = Object.freeze({
  accountDeletion: "账户注销功能仍在安全建设中",
  communityPublish: "社区发布功能仍在安全建设中",
  communityPostEdit: "帖子编辑功能仍在安全建设中",
  communityLegacyLike: "社区点赞兼容接口尚未启用",
  communityDemo: "社区演示数据未启用",
  cloudDrafts: "云草稿功能仍在建设中",
  notifications: "消息中心仍在建设中",
  sse: "实时消息推送仍在建设中",
});

function getPublicCapabilities() {
  const disabledReasons = {};
  for (const [feature, enabled] of Object.entries(featureFlags)) {
    if (!enabled) disabledReasons[feature] = disabledReasonCopy[feature];
  }

  return {
    features: { ...featureFlags },
    limits: { ...mediaLimits },
    disabledReasons,
  };
}

module.exports = {
  COMMUNITY_IMAGE_MAX_BYTES,
  COMMUNITY_VIDEO_MAX_BYTES,
  featureFlags,
  getPublicCapabilities,
  isExplicitlyEnabled,
  mediaLimits,
};
