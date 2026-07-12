(function exposeCommunityApi(global) {
  const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

  function createCommunityApi(options = {}) {
    const baseUrl = String(options.baseUrl || "").replace(/\/$/, "");
    const defaultTimeoutMs = Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs)
      : DEFAULT_REQUEST_TIMEOUT_MS;

    function createRequestError(message, details = {}) {
      const error = new Error(message);
      if (details.status) error.status = details.status;
      if (details.code) error.code = details.code;
      if (details.requestId) error.requestId = details.requestId;
      if (details.cause) error.cause = details.cause;
      return error;
    }

    function normalizePost(post) {
      if (!post || typeof post !== "object") return post;
      if (baseUrl && ((post.imageUrl && post.imageUrl.startsWith("/api/")) || (post.videoUrl && post.videoUrl.startsWith("/api/")))) {
        return {
          ...post,
          imageUrl: post.imageUrl?.startsWith("/api/") ? `${baseUrl}${post.imageUrl}` : post.imageUrl || "",
          videoUrl: post.videoUrl?.startsWith("/api/") ? `${baseUrl}${post.videoUrl}` : post.videoUrl || "",
        };
      }
      return post;
    }

    async function request(path = "", requestOptions = {}) {
      const query = requestOptions.query
        ? `?${new URLSearchParams(requestOptions.query).toString()}`
        : "";
      const controller = new AbortController();
      const timeoutMs = Number(requestOptions.timeoutMs) > 0 ? Number(requestOptions.timeoutMs) : defaultTimeoutMs;
      const timeoutId = global.setTimeout(() => controller.abort(), timeoutMs);
      let response;

      try {
        const apiPath = requestOptions.apiPath || `/api/community/posts${path}`;
        response = await fetch(`${baseUrl}${apiPath}${query}`, {
          method: requestOptions.method || "GET",
          credentials: "include",
          headers: {
            Accept: "application/json",
            ...(requestOptions.body ? { "Content-Type": "application/json" } : {}),
            ...(requestOptions.headers || {}),
          },
          body: requestOptions.body ? JSON.stringify(requestOptions.body) : undefined,
          signal: controller.signal,
        });
      } catch (error) {
        if (error?.name === "AbortError") {
          throw createRequestError("请求超时，请检查网络后重试。", {
            code: "REQUEST_TIMEOUT",
            cause: error,
          });
        }

        throw createRequestError("网络连接失败，请检查网络后重试。", {
          code: "NETWORK_ERROR",
          cause: error,
        });
      } finally {
        global.clearTimeout(timeoutId);
      }

      const rawBody = await response.text();
      const requestId = response.headers.get("X-Request-Id") || "";
      let data = null;
      try {
        data = rawBody ? JSON.parse(rawBody) : null;
      } catch (error) {
        if (response.ok) {
          throw createRequestError("社区服务返回格式异常，请稍后重试。", {
            status: response.status,
            code: "PARSE_ERROR",
            requestId,
            cause: error,
          });
        }
      }

      if (!response.ok) {
        const message = data?.message || "社区请求失败，请稍后重试。";
        throw createRequestError(message, {
          status: response.status,
          code: data?.code || "HTTP_ERROR",
          requestId: data?.requestId || requestId,
        });
      }

      return data;
    }

    return {
      async list(options = {}) {
        const data = await request("", { query: options });
        return {
          posts: Array.isArray(data?.posts) ? data.posts.map(normalizePost) : [],
          pageInfo: data?.pageInfo || { limit: 0, offset: 0, nextOffset: 0, hasMore: false },
        };
      },
      async get(id, options = {}) {
        const data = await request(`/${encodeURIComponent(id)}`, { query: options });
        return normalizePost(data.post);
      },
      async create(post) {
        const data = await request("", { method: "POST", body: post });
        return normalizePost(data.post);
      },
      async update(id, post) {
        const data = await request(`/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: post,
        });
        return normalizePost(data.post);
      },
      async remove(id) {
        await request(`/${encodeURIComponent(id)}`, { method: "DELETE" });
      },
      async comment(id, body) {
        const data = await request(`/${encodeURIComponent(id)}/comments`, {
          method: "POST",
          body: { body },
        });
        return normalizePost(data.post);
      },
      async listComments(id, options = {}) {
        const data = await request(`/${encodeURIComponent(id)}/comments`, { query: options });
        return {
          comments: Array.isArray(data?.comments) ? data.comments : [],
          pageInfo: data?.pageInfo || { limit: 0, offset: 0, nextOffset: 0, hasMore: false, total: 0, commentCount: 0 },
        };
      },
      async deleteComment(postId, commentId) {
        await request(`/${encodeURIComponent(postId)}/comments/${encodeURIComponent(commentId)}`, { method: "DELETE" });
      },
      async question(id, body) {
        const data = await request(`/${encodeURIComponent(id)}/questions`, {
          method: "POST",
          body: { body },
        });
        return normalizePost(data.post);
      },
      async react(id, reactionType) {
        const data = await request(`/${encodeURIComponent(id)}/reactions`, {
          method: "POST",
          body: { reactionType },
        });
        return normalizePost(data.post);
      },
      async listFeed(type = "recommended", options = {}) {
        const data = await request("", {
          apiPath: "/api/v1/feed",
          query: { type, ...(options || {}) },
        });
        return {
          posts: Array.isArray(data?.data) ? data.data.map(normalizePost) : [],
          pageInfo: data?.pageInfo || { limit: 0, hasMore: false, nextCursor: null },
        };
      },
      async listMyPosts(options = {}) {
        const data = await request("", { apiPath: "/api/v1/me/posts", query: options });
        return {
          posts: Array.isArray(data?.data) ? data.data.map(normalizePost) : [],
          pageInfo: data?.pageInfo || { limit: 0, hasMore: false, nextCursor: null },
        };
      },
      async getMyStats() {
        const data = await request("", { apiPath: "/api/v1/me/stats" });
        return data?.data || { posts: 0, observations: 0, followers: 0, following: 0 };
      },
      async setLike(id, liked) {
        const data = await request("", {
          apiPath: `/api/v1/posts/${encodeURIComponent(id)}/like`,
          method: liked ? "PUT" : "DELETE",
        });
        return normalizePost(data?.data?.post);
      },
      async setFollow(userId, following) {
        const data = await request("", {
          apiPath: `/api/v1/users/${encodeURIComponent(userId)}/follow`,
          method: following ? "PUT" : "DELETE",
        });
        return data?.data || null;
      },
      async getProfile(userId) {
        const data = await request("", {
          apiPath: `/api/v1/users/${encodeURIComponent(userId)}`,
        });
        return data?.data || null;
      },
      async listDrafts(options = {}) {
        const data = await request("", { apiPath: "/api/v1/drafts", query: options });
        return {
          drafts: Array.isArray(data?.data) ? data.data : [],
          pageInfo: data?.pageInfo || { limit: 0, hasMore: false, nextCursor: null },
        };
      },
      async createDraft(fields) {
        const data = await request("", { apiPath: "/api/v1/drafts", method: "POST", body: fields });
        return data?.data || null;
      },
      async updateDraft(draftId, version, changes) {
        const data = await request("", {
          apiPath: `/api/v1/drafts/${encodeURIComponent(draftId)}`,
          method: "PATCH",
          body: { version, ...changes },
        });
        return data?.data || null;
      },
      async deleteDraft(draftId) {
        await request("", {
          apiPath: `/api/v1/drafts/${encodeURIComponent(draftId)}`,
          method: "DELETE",
        });
      },
      async publishDraft(draftId, version, idempotencyKey, media = {}) {
        const data = await request("", {
          apiPath: `/api/v1/drafts/${encodeURIComponent(draftId)}/publish`,
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: { version, ...(media || {}) },
        });
        return normalizePost(data?.data);
      },
      async listNotifications(options = {}) {
        const data = await request("", { apiPath: "/api/v1/notifications", query: options });
        return {
          notifications: Array.isArray(data?.data) ? data.data : [],
          pageInfo: data?.pageInfo || { limit: 0, hasMore: false, nextCursor: null },
        };
      },
      async getUnreadNotificationCount() {
        const data = await request("", { apiPath: "/api/v1/notifications/unread-count" });
        return Number(data?.data?.count) || 0;
      },
      async markNotificationRead(notificationId) {
        const data = await request("", {
          apiPath: `/api/v1/notifications/${encodeURIComponent(notificationId)}/read`,
          method: "POST",
        });
        return data?.data || null;
      },
      async markAllNotificationsRead() {
        const data = await request("", { apiPath: "/api/v1/notifications/read-all", method: "POST" });
        return Number(data?.data?.updated) || 0;
      },
      async getNotificationPreferences() {
        const data = await request("", { apiPath: "/api/v1/notification-preferences" });
        return data?.data || null;
      },
      async updateNotificationPreferences(changes) {
        const data = await request("", {
          apiPath: "/api/v1/notification-preferences",
          method: "PATCH",
          body: changes,
        });
        return data?.data || null;
      },
    };
  }

  global.BirdoraCommunityApi = { createCommunityApi };
})(window);
