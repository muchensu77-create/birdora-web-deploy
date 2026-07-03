const path = require("path");
const { Worker } = require("worker_threads");

const bcrypt = require("bcryptjs");

const authConfig = require("../config/auth.config");

const workerPath = path.join(__dirname, "password-worker.js");
let pool = null;
let nextTaskId = 1;

function createWorkerSlot(index) {
  const slot = {
    index,
    worker: new Worker(workerPath),
    activeTask: null,
    queue: [],
    failed: false,
  };

  slot.worker.on("message", (message) => {
    const task = slot.activeTask;
    if (!task || task.id !== message.id) return;

    slot.activeTask = null;
    if (message.error) {
      const error = new Error(message.error.message);
      error.name = message.error.name || "PasswordWorkerError";
      error.stack = message.error.stack || error.stack;
      task.reject(error);
    } else {
      task.resolve(message.result);
    }

    pumpWorkerSlot(slot);
  });

  slot.worker.on("error", (error) => {
    failWorkerSlot(slot, error);
  });

  slot.worker.on("exit", (code) => {
    if (code !== 0) {
      failWorkerSlot(slot, new Error(`Password worker ${index} exited with code ${code}`));
    }
  });

  return slot;
}

function getPool() {
  if (authConfig.passwordWorkerPoolSize <= 0) return null;
  if (!pool) {
    pool = Array.from({ length: authConfig.passwordWorkerPoolSize }, (_, index) =>
      createWorkerSlot(index)
    );
  }

  return pool;
}

function taskLoad(slot) {
  return slot.queue.length + (slot.activeTask ? 1 : 0);
}

function getLeastBusySlot(slots) {
  return slots.reduce((best, slot) => (taskLoad(slot) < taskLoad(best) ? slot : best), slots[0]);
}

function pumpWorkerSlot(slot) {
  if (slot.failed || slot.activeTask || slot.queue.length === 0) return;

  const task = slot.queue.shift();
  slot.activeTask = task;
  slot.worker.postMessage({
    id: task.id,
    action: task.action,
    password: task.password,
    passwordHash: task.passwordHash,
    rounds: task.rounds,
  });
}

function failWorkerSlot(slot, error) {
  if (slot.failed) return;
  slot.failed = true;

  const pendingTasks = [
    ...(slot.activeTask ? [slot.activeTask] : []),
    ...slot.queue.splice(0),
  ];
  slot.activeTask = null;

  for (const task of pendingTasks) {
    task.reject(error);
  }
}

function runInWorker(action, payload) {
  const slots = getPool();
  if (!slots) return null;

  const availableSlots = slots.filter((slot) => !slot.failed);
  if (!availableSlots.length) return null;

  const slot = getLeastBusySlot(availableSlots);
  return new Promise((resolve, reject) => {
    slot.queue.push({
      id: nextTaskId++,
      action,
      ...payload,
      resolve,
      reject,
    });
    pumpWorkerSlot(slot);
  });
}

async function hashPassword(password) {
  const workerResult = runInWorker("hash", {
    password,
    rounds: authConfig.passwordHashCost,
  });
  if (workerResult) return workerResult;

  return bcrypt.hash(password, authConfig.passwordHashCost);
}

async function verifyPassword(password, passwordHash) {
  const workerResult = runInWorker("compare", {
    password,
    passwordHash,
  });
  if (workerResult) return workerResult;

  return bcrypt.compare(password, passwordHash);
}

module.exports = {
  hashPassword,
  verifyPassword,
};
