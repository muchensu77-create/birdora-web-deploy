const assert = require("assert/strict");

const { createBoundedWorkQueue } = require("../app/services/recognition-work-queue");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

async function testBoundedQueue() {
  const blocker = deferred();
  const queue = createBoundedWorkQueue({
    maxConcurrency: 1,
    maxQueue: 1,
    waitTimeoutMs: 1_000,
  });

  const first = queue.run(() => blocker.promise);
  const second = queue.run(() => "second-result");
  await assert.rejects(
    queue.run(() => "must-not-run"),
    (error) => error.statusCode === 503 && error.code === "RECOGNITION_BUSY"
  );
  assert.deepEqual(queue.getStats(), {
    active: 1,
    pending: 1,
    maxConcurrency: 1,
    maxQueue: 1,
    waitTimeoutMs: 1_000,
  });

  blocker.resolve("first-result");
  assert.equal(await first, "first-result");
  assert.equal(await second, "second-result");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queue.getStats().active, 0);
  assert.equal(queue.getStats().pending, 0);
}

async function testQueueWaitTimeout() {
  const blocker = deferred();
  const queue = createBoundedWorkQueue({
    maxConcurrency: 1,
    maxQueue: 1,
    waitTimeoutMs: 25,
  });

  const first = queue.run(() => blocker.promise);
  await assert.rejects(
    queue.run(() => "must-time-out"),
    (error) => error.statusCode === 503 && error.code === "RECOGNITION_QUEUE_TIMEOUT"
  );
  assert.equal(queue.getStats().pending, 0);
  blocker.resolve("released");
  assert.equal(await first, "released");
}

async function main() {
  await testBoundedQueue();
  console.log("PASS recognition work queue enforces concurrency and queue bounds");
  await testQueueWaitTimeout();
  console.log("PASS recognition work queue expires queued requests");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
