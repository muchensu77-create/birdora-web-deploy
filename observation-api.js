(function exposeObservationApi(global) {
  function createObservationApi(options = {}) {
    const baseUrl = String(options.baseUrl || "").replace(/\/$/, "");

    function normalizeObservation(observation) {
      if (!observation || typeof observation !== "object") return observation;
      if (observation.imageUrl && observation.imageUrl.startsWith("/api/") && baseUrl) {
        return {
          ...observation,
          imageUrl: `${baseUrl}${observation.imageUrl}`,
        };
      }
      return observation;
    }

    async function request(path = "", requestOptions = {}) {
      const query = requestOptions.query
        ? `?${new URLSearchParams(requestOptions.query).toString()}`
        : "";
      const response = await fetch(`${baseUrl}/api/observations${path}${query}`, {
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
        const message = data?.message || "观测记录请求失败，请稍后重试。";
        const error = new Error(message);
        error.status = response.status;
        throw error;
      }

      return data;
    }

    return {
      async createObservation(observation) {
        const data = await request("", { method: "POST", body: observation });
        return normalizeObservation(data.observation);
      },
      async listMyObservations(options = {}) {
        const data = await request("/me", { query: options });
        return {
          observations: Array.isArray(data?.observations)
            ? data.observations.map(normalizeObservation)
            : [],
          pageInfo: data?.pageInfo || { limit: 0, offset: 0, nextOffset: 0, hasMore: false },
        };
      },
      async getObservation(id) {
        const data = await request(`/${encodeURIComponent(id)}`);
        return normalizeObservation(data.observation);
      },
      async deleteObservation(id) {
        await request(`/${encodeURIComponent(id)}`, { method: "DELETE" });
      },
    };
  }

  global.BirdoraObservationApi = { createObservationApi };
})(window);
