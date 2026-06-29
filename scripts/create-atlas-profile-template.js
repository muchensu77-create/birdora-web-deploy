const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const candidatesPath = path.join(rootDir, "assets", "atlas", "common-bird-candidates.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parsePriority() {
  const raw = process.argv[2] || process.env.ATLAS_PRIORITY;
  const priority = Number(raw);

  if (!Number.isInteger(priority) || priority <= 0) {
    throw new Error("Usage: node scripts/create-atlas-profile-template.js <priority>");
  }

  return priority;
}

function main() {
  const priority = parsePriority();
  const candidateFile = readJson(candidatesPath);
  const candidate = candidateFile.candidates.find((item) => item.priority === priority);

  if (!candidate) {
    throw new Error(`No candidate found for priority ${priority}.`);
  }

  const template = {
    oseaIndex: candidate.oseaIndex,
    name: candidate.name,
    latin: candidate.latin,
    habitat: "待分类",
    place: "待补充",
    feature: "待补充",
    food: "待补充",
    image: "https://example.com/replace-with-licensed-image.jpg",
    source: "https://example.com/replace-with-source-page",
    imageCredit: "待补充",
    license: "待补充",
    clue: "待补充",
  };

  console.log(JSON.stringify(template, null, 2));
}

main();
