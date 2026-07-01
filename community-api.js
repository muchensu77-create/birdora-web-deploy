(function exposeCommunityApi(global) {
  function createCommunityApi(options = {}) {
    const baseUrl = String(options.baseUrl || "").replace(/\/$/, "");

    async function request(path = "", requestOptions = {}) {
      const response = await fetch(`${baseUrl}/api/community/posts${path}`, {
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
      async list() {
        const data = await request();
        return Array.isArray(data?.posts) ? data.posts : [];
      },
      async create(post) {
        const data = await request("", { method: "POST", body: post });
        return data.post;
      },
      async update(id, post) {
        const data = await request(`/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: post,
        });
        return data.post;
      },
      async remove(id) {
        await request(`/${encodeURIComponent(id)}`, { method: "DELETE" });
      },
    };
  }

  global.BirdoraCommunityApi = { createCommunityApi };
})(window);
