function parseBoundedInteger(value, fallback, { min, max }) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function createQueueError(message, code) {
  const error = new Error(message);
  error.statusCode = 503;
  error.code = code;
  return error;
}

function createBoundedWorkQueue({
  maxConcurrency = 2,
  maxQueue = 8,
  waitTimeoutMs = 10_000,
} = {}) {
  const concurrencyLimit = parseBoundedInteger(maxConcurrency, 2, { min: 1, max: 32 });
  const queueLimit = parseBoundedInteger(maxQueue, 8, { min: 0, max: 1_000 });
  const queueWaitTimeout = parseBoundedInteger(waitTimeoutMs, 10_000, { min: 10, max: 300_000 });
  const pending = [];
  let active = 0;

  function drain() {
    while (active < concurrencyLimit && pending.length) {
      const entry = pending.shift();
      clearTimeout(entry.timer);
      start(entry);
    }
  }

  function start(entry) {
    active += 1;
    Promise.resolve()
      .then(entry.task)
      .then(entry.resolve, entry.reject)
      .finally(() => {
        active -= 1;
        drain();
      });
  }

  function run(task) {
    if (typeof task !== "function") {
      return Promise.reject(new TypeError("queue task must be a function"));
    }

    return new Promise((resolve, reject) => {
      const entry = { task, resolve, reject, timer: null };
      if (active < concurrencyLimit) {
        start(entry);
        return;
      }

      if (pending.length >= queueLimit) {
        reject(createQueueError("recognition service is busy", "RECOGNITION_BUSY"));
        return;
      }

      entry.timer = setTimeout(() => {
        const index = pending.indexOf(entry);
        if (index === -1) return;
        pending.splice(index, 1);
        reject(createQueueError("recognition queue wait timed out", "RECOGNITION_QUEUE_TIMEOUT"));
      }, queueWaitTimeout);
      pending.push(entry);
    });
  }

  function getStats() {
    return {
      active,
      pending: pending.length,
      maxConcurrency: concurrencyLimit,
      maxQueue: queueLimit,
      waitTimeoutMs: queueWaitTimeout,
    };
  }

  return { getStats, run };
}

const recognitionQueue = createBoundedWorkQueue({
  maxConcurrency: parseBoundedInteger(process.env.RECOGNITION_MAX_CONCURRENCY, 2, { min: 1, max: 8 }),
  maxQueue: parseBoundedInteger(process.env.RECOGNITION_MAX_QUEUE, 8, { min: 0, max: 100 }),
  waitTimeoutMs: parseBoundedInteger(process.env.RECOGNITION_QUEUE_TIMEOUT_MS, 10_000, { min: 100, max: 60_000 }),
});

module.exports = {
  createBoundedWorkQueue,
  getRecognitionQueueStats: recognitionQueue.getStats,
  runRecognitionTask: recognitionQueue.run,
};
