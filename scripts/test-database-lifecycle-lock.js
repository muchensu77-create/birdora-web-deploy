"use strict";

const assert = require("assert");
const { parseProcLocks } = require("../app/runtime/database-lifecycle-lock");

const parsed = parseProcLocks([
  "1: FLOCK  ADVISORY  READ  1234 08:01:987654 0 EOF",
  "2: FLOCK  ADVISORY  WRITE 4321 08:01:123456 0 EOF",
  "3: POSIX  ADVISORY  WRITE 1111 08:01:555555 0 EOF",
  "4: -> FLOCK ADVISORY WRITE 9999 08:01:777777 0 EOF",
  "5: FLOCK ADVISORY WRITE 9999 zz:01:777777 0 EOF",
  "6: FLOCK ADVISORY WRITE 9999 08:gg:777777 0 EOF",
  "invalid",
].join("\n"));

assert.deepStrictEqual(parsed.map(({ mode, pid, deviceMajor, deviceMinor, inode }) => ({ mode, pid, deviceMajor, deviceMinor, inode })), [
  { mode: "READ", pid: 1234, deviceMajor: 8n, deviceMinor: 1n, inode: 987654n },
  { mode: "WRITE", pid: 4321, deviceMajor: 8n, deviceMinor: 1n, inode: 123456n },
]);
console.log("Database lifecycle lock parser tests passed.");
