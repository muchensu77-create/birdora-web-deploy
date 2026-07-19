"use strict";

const { closeDatabase, getDatabase, resolveDatabaseOptions } = require("../app/db/database");
const moderationService = require("../app/services/moderation.service");
const { assertExclusiveDatabaseLifecycleLock } = require("../app/runtime/database-lifecycle-lock");

function enabled(value) {
  return /^(1|true|yes)$/iu.test(String(value || "").trim());
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key.startsWith("--") || index + 1 >= rest.length) throw new Error(`Invalid argument: ${key}`);
    values[key.slice(2)] = rest[index + 1];
    index += 1;
  }
  return { command, values };
}

function commandDefinition(command) {
  const match = /^(grant|revoke)-(moderator|admin)$/u.exec(String(command || ""));
  if (!match) {
    throw new Error("Command must be grant-moderator, revoke-moderator, grant-admin, or revoke-admin");
  }
  return { grant: match[1] === "grant", role: match[2] };
}

function main() {
  if (!enabled(process.env.ADMIN_ROLE_CLI_ENABLED)) {
    throw new Error("ADMIN_ROLE_CLI_ENABLED=true is required");
  }
  const resolved = resolveDatabaseOptions();
  if (resolved.productionLike && !enabled(process.env.ADMIN_ROLE_CLI_MAINTENANCE_CONFIRMED)) {
    throw new Error("Production-like role changes require maintenance mode and ADMIN_ROLE_CLI_MAINTENANCE_CONFIRMED=true");
  }
  if (resolved.productionLike) assertExclusiveDatabaseLifecycleLock();
  const { command, values } = parseArguments(process.argv.slice(2));
  const definition = commandDefinition(command);
  const target = String(values.user || "").trim();
  const reason = String(values.reason || "").trim();
  const actorLabel = String(values["actor-label"] || process.env.ADMIN_ROLE_ACTOR_LABEL || "").trim();
  const actorUserId = String(values["actor-user"] || "").trim() || null;
  if (!target) throw new Error("--user is required (UUID or email)");
  if (reason.length < 3 || reason.length > 500) throw new Error("--reason must contain 3 to 500 characters");
  if (actorLabel.length < 3 || actorLabel.length > 80) throw new Error("--actor-label or ADMIN_ROLE_ACTOR_LABEL must contain 3 to 80 characters");

  getDatabase();
  const result = moderationService.setUserRoleFromCli({
    target,
    role: definition.role,
    grant: definition.grant,
    reason,
    actorUserId,
    actorLabel,
  });
  console.log(JSON.stringify({ ok: true, ...result }));
}

try {
  main();
} catch (error) {
  console.error(`Role change failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  closeDatabase();
}
