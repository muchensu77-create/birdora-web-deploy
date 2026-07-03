(function exposeObservationApi(global) {
  const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

  function createObservationApi(options = {}) {
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
      const controller = new AbortController();
      const timeoutMs = Number(requestOptions.timeoutMs) > 0 ? Number(requestOptions.timeoutMs) : defaultTimeoutMs;
      const timeoutId = global.setTimeout(() => controller.abort(), timeoutMs);
      let response;

      try {
        response = await fetch(`${baseUrl}/api/observations${path}${query}`, {
          method: requestOptions.method || "GET",
          credentials: "include",
          headers: {
            Accept: "application/json",
            ...(requestOptions.body ? { "Content-Type": "application/json" } : {}),
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
          throw createRequestError("观测记录服务返回格式异常，请稍后重试。", {
            status: response.status,
            code: "PARSE_ERROR",
            requestId,
            cause: error,
          });
        }
      }

      if (!response.ok) {
        const message = data?.message || "观测记录请求失败，请稍后重试。";
        throw createRequestError(message, {
          status: response.status,
          code: data?.code || "HTTP_ERROR",
          requestId: data?.requestId || requestId,
        });
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
