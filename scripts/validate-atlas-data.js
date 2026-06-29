const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const profilesPath = path.join(rootDir, "assets", "atlas", "bird-profiles.json");
const candidatesPath = path.join(rootDir, "assets", "atlas", "common-bird-candidates.json");
const labelsPath = path.join(rootDir, "assets", "osea", "bird_info.json");

const requiredStringFields = [
  "name",
  "latin",
  "habitat",
  "place",
  "feature",
  "food",
  "image",
  "source",
  "imageCredit",
  "license",
  "clue",
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function addIssue(issues, severity, message) {
  issues.push({ severity, message });
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateProfile(profile, index, labels, issues) {
  const label = Number.isInteger(profile.oseaIndex) ? labels[profile.oseaIndex] : null;

  if (!Number.isInteger(profile.oseaIndex)) {
    addIssue(issues, "error", `Profile ${index + 1} (${profile.name || "unnamed"}) is missing integer oseaIndex.`);
  } else if (!label) {
    addIssue(issues, "error", `${profile.name} has oseaIndex ${profile.oseaIndex}, which is outside bird_info.json.`);
  }

  for (const field of requiredStringFields) {
    if (typeof profile[field] !== "string" || !profile[field].trim()) {
      addIssue(issues, "error", `${profile.name || `Profile ${index + 1}`} is missing ${field}.`);
    }
  }

  if (profile.image && !isHttpUrl(profile.image)) {
    addIssue(issues, "error", `${profile.name} image must be an http(s) URL.`);
  }

  if (profile.source && !isHttpUrl(profile.source)) {
    addIssue(issues, "error", `${profile.name} source must be an http(s) URL.`);
  }

  if (label) {
    const [, , labelLatin] = label;
    if (profile.latin && labelLatin && profile.latin !== labelLatin) {
      addIssue(
        issues,
        "warning",
        `${profile.name} latin name ${profile.latin} differs from OSEA label ${labelLatin}.`
      );
    }
  }
}

function validateUnique(profiles, issues) {
  const seenIndexes = new Map();
  const seenNames = new Map();
  const seenLatin = new Map();

  profiles.forEach((profile, index) => {
    const pairs = [
      ["oseaIndex", profile.oseaIndex, seenIndexes],
      ["name", profile.name, seenNames],
      ["latin", profile.latin, seenLatin],
    ];

    for (const [field, value, seen] of pairs) {
      if (value == null || value === "") continue;

      if (seen.has(value)) {
        addIssue(
          issues,
          "error",
          `${field} "${value}" is duplicated at profiles ${seen.get(value) + 1} and ${index + 1}.`
        );
      } else {
        seen.set(value, index);
      }
    }
  });
}

function validateCandidate(candidate, arrayIndex, labels, issues) {
  const label = Number.isInteger(candidate.oseaIndex) ? labels[candidate.oseaIndex] : null;
  const context = candidate.name || `Candidate ${arrayIndex + 1}`;

  if (candidate.priority !== arrayIndex + 1) {
    addIssue(issues, "error", `${context} priority should be ${arrayIndex + 1}.`);
  }

  for (const field of ["group", "name", "en", "latin"]) {
    if (typeof candidate[field] !== "string" || !candidate[field].trim()) {
      addIssue(issues, "error", `${context} is missing ${field}.`);
    }
  }

  if (!Number.isInteger(candidate.oseaIndex)) {
    addIssue(issues, "error", `${context} is missing integer oseaIndex.`);
    return;
  }

  if (!label) {
    addIssue(issues, "error", `${context} has oseaIndex ${candidate.oseaIndex}, which is outside bird_info.json.`);
    return;
  }

  const [cn, en, latin] = label;
  if (candidate.name !== cn) {
    addIssue(issues, "error", `${context} name differs from OSEA label ${cn}.`);
  }
  if (candidate.en !== en) {
    addIssue(issues, "error", `${context} English name differs from OSEA label ${en}.`);
  }
  if (candidate.latin !== latin) {
    addIssue(issues, "error", `${context} latin name differs from OSEA label ${latin}.`);
  }
}

function validateCandidates(candidateFile, labels, profileIndexes, issues) {
  if (!candidateFile || !Array.isArray(candidateFile.candidates)) {
    addIssue(issues, "error", "common-bird-candidates.json must contain a candidates array.");
    return;
  }

  if (candidateFile.candidates.length !== 100) {
    addIssue(issues, "error", `Candidate list should contain 100 birds, found ${candidateFile.candidates.length}.`);
  }

  const seenIndexes = new Map();
  const seenNames = new Map();

  candidateFile.candidates.forEach((candidate, index) => {
    validateCandidate(candidate, index, labels, issues);

    for (const [field, value, seen] of [
      ["oseaIndex", candidate.oseaIndex, seenIndexes],
      ["name", candidate.name, seenNames],
    ]) {
      if (value == null || value === "") continue;

      if (seen.has(value)) {
        addIssue(
          issues,
          "error",
          `Candidate ${field} "${value}" is duplicated at candidates ${seen.get(value) + 1} and ${index + 1}.`
        );
      } else {
        seen.set(value, index);
      }
    }
  });

  const firstTenMissingProfiles = candidateFile.candidates
    .slice(0, 10)
    .filter((candidate) => !profileIndexes.has(candidate.oseaIndex))
    .map((candidate) => candidate.name);

  if (firstTenMissingProfiles.length) {
    addIssue(
      issues,
      "warning",
      `First 10 candidates are expected to already have rich profiles, missing: ${firstTenMissingProfiles.join(", ")}.`
    );
  }
}

function main() {
  const profiles = readJson(profilesPath);
  const candidateFile = readJson(candidatesPath);
  const labels = readJson(labelsPath);
  const issues = [];

  if (!Array.isArray(profiles)) {
    throw new Error("bird-profiles.json must be an array.");
  }

  if (!Array.isArray(labels)) {
    throw new Error("bird_info.json must be an array.");
  }

  profiles.forEach((profile, index) => validateProfile(profile, index, labels, issues));
  validateUnique(profiles, issues);
  validateCandidates(candidateFile, labels, new Set(profiles.map((profile) => profile.oseaIndex)), issues);

  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  for (const issue of issues) {
    console.log(`${issue.severity.toUpperCase()}: ${issue.message}`);
  }

  console.log(
    `Atlas data validation: ${profiles.length} profiles, ${candidateFile.candidates.length} candidates, ${errors.length} errors, ${warnings.length} warnings.`
  );

  if (errors.length) {
    process.exitCode = 1;
  }
}

main();
