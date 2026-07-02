(function exposeCommunityApi(global) {
  function createCommunityApi(options = {}) {
    const baseUrl = String(options.baseUrl || "").replace(/\/$/, "");

    function normalizePost(post) {
      if (!post || typeof post !== "object") return post;
      if (post.imageUrl && post.imageUrl.startsWith("/api/") && baseUrl) {
        return {
          ...post,
          imageUrl: `${baseUrl}${post.imageUrl}`,
        };
      }
      return post;
    }

    async function request(path = "", requestOptions = {}) {
      const query = requestOptions.query
        ? `?${new URLSearchParams(requestOptions.query).toString()}`
        : "";
      const response = await fetch(`${baseUrl}/api/community/posts${path}${query}`, {
        method: requestOptions.method || "GET",
        credentials: "include",
        headers: {
          Accept: "application/json",
          ...(requestOptions.body ? { "Content-Type": "application/json" } : {}),
        },
        body: requestOptions.body ? JSON.stringify(requestOptions.body) : undefined,
      });

      const rawBody = await response.text();
      let data = null;
      try {
        data = rawBody ? JSON.parse(rawBody) : null;
      } catch {
        data = null;
      }

      if (!response.ok) {
        const message = data?.message || "社区请求失败，请稍后重试。";
        const error = new Error(message);
        error.status = response.status;
        throw error;
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
    };
  }

  global.BirdoraCommunityApi = { createCommunityApi };
})(window);
