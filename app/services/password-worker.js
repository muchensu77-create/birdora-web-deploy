const bcrypt = require("bcryptjs");
const { parentPort } = require("worker_threads");

async function handleTask(task) {
  if (task.action === "hash") {
    return bcrypt.hash(task.password, task.rounds);
  }

  if (task.action === "compare") {
    return bcrypt.compare(task.password, task.passwordHash);
  }

  throw new Error(`Unsupported password worker action: ${task.action}`);
}

parentPort.on("message", async (task) => {
  try {
    const result = await handleTask(task);
    parentPort.postMessage({ id: task.id, result });
  } catch (error) {
    parentPort.postMessage({
      id: task.id,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    });
  }
});
