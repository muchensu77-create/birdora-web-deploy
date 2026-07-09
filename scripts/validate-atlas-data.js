const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const profilesPath = path.join(rootDir, "assets", "atlas", "bird-profiles.json");
const candidatesPath = path.join(rootDir, "assets", "atlas", "common-bird-candidates.json");
const labelsPath = path.join(rootDir, "assets", "osea", "bird_info.json");
const vendorDir = path.join(rootDir, "assets", "vendor");
const publicVendorDir = path.join(rootDir, "public", "assets", "vendor");
const expectedOseaOutputCount = 11000;

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
  const placeholderPattern = /^(待补充|待分类|TODO|TBD)\b/i;

  if (!Number.isInteger(profile.oseaIndex)) {
    addIssue(issues, "error", `Profile ${index + 1} (${profile.name || "unnamed"}) is missing integer oseaIndex.`);
  } else if (!label) {
    addIssue(issues, "error", `${profile.name} has oseaIndex ${profile.oseaIndex}, which is outside bird_info.json.`);
  }

  for (const field of requiredStringFields) {
    if (typeof profile[field] !== "string" || !profile[field].trim()) {
      addIssue(issues, "error", `${profile.name || `Profile ${index + 1}`} is missing ${field}.`);
    } else if (placeholderPattern.test(profile[field].trim())) {
      addIssue(issues, "error", `${profile.name || `Profile ${index + 1}`} still has placeholder ${field}.`);
    }
  }

  if (profile.image && !isHttpUrl(profile.image)) {
    addIssue(issues, "error", `${profile.name} image must be an http(s) URL.`);
  } else if (profile.image && profile.image.includes("example.com")) {
    addIssue(issues, "error", `${profile.name} image still points to example.com.`);
  }

  if (profile.source && !isHttpUrl(profile.source)) {
    addIssue(issues, "error", `${profile.name} source must be an http(s) URL.`);
  } else if (profile.source && profile.source.includes("example.com")) {
    addIssue(issues, "error", `${profile.name} source still points to example.com.`);
  }

  if (label) {
    const [labelName, , labelLatin] = label;
    const acceptedNames = new Set([
      profile.name,
      profile.oseaName,
      ...(Array.isArray(profile.aliases) ? profile.aliases : []),
    ].filter(Boolean));

    if (!acceptedNames.has(labelName)) {
      addIssue(
        issues,
        "error",
        `${profile.name} does not include OSEA Chinese label ${labelName}; add oseaName or aliases if this is intentional.`
      );
    }

    if (profile.latin && labelLatin && profile.latin !== labelLatin) {
      addIssue(
        issues,
        "error",
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
  if (!Number.isInteger(candidateFile?.version)) {
    addIssue(issues, "error", "common-bird-candidates.json version must be an integer.");
  }

  if (typeof candidateFile?.updatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(candidateFile.updatedAt)) {
    addIssue(issues, "error", "common-bird-candidates.json updatedAt must be YYYY-MM-DD.");
  }

  if (typeof candidateFile?.description !== "string" || !candidateFile.description.trim()) {
    addIssue(issues, "error", "common-bird-candidates.json description is required.");
  }

  if (!candidateFile || !Array.isArray(candidateFile.candidates)) {
    addIssue(issues, "error", "common-bird-candidates.json must contain a candidates array.");
    return;
  }

  if (candidateFile.candidates.length !== 100) {
    addIssue(issues, "error", `Candidate list should contain 100 birds, found ${candidateFile.candidates.length}.`);
  }

  const seenIndexes = new Map();
  const seenNames = new Map();
  const seenEn = new Map();
  const seenLatin = new Map();

  candidateFile.candidates.forEach((candidate, index) => {
    validateCandidate(candidate, index, labels, issues);

    for (const [field, value, seen] of [
      ["oseaIndex", candidate.oseaIndex, seenIndexes],
      ["name", candidate.name, seenNames],
      ["en", candidate.en, seenEn],
      ["latin", candidate.latin, seenLatin],
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

function readFileStart(filePath, byteCount) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(byteCount);
    const bytesRead = fs.readSync(fd, buffer, 0, byteCount, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function validateWasmFile(filePath, issues) {
  if (!fs.existsSync(filePath)) {
    addIssue(issues, "error", `Required WASM resource is missing: ${path.relative(rootDir, filePath)}.`);
    return;
  }

  const magic = readFileStart(filePath, 4);
  const isWasm = magic.length === 4 && magic[0] === 0x00 && magic[1] === 0x61 && magic[2] === 0x73 && magic[3] === 0x6d;
  if (!isWasm) {
    const preview = readFileStart(filePath, 80).toString("utf8").replace(/\s+/g, " ").trim();
    addIssue(
      issues,
      "error",
      `${path.relative(rootDir, filePath)} is not a valid WASM binary. Preview: ${preview || "<binary preview unavailable>"}`
    );
  }
}

function validateVendorResources(issues) {
  const requiredFiles = [
    path.join(vendorDir, "ort.min.js"),
    path.join(vendorDir, "ort-wasm-simd-threaded.mjs"),
    path.join(vendorDir, "ort-wasm-simd-threaded.wasm"),
  ];

  for (const filePath of requiredFiles) {
    if (!fs.existsSync(filePath)) {
      addIssue(issues, "error", `Required vendor resource is missing: ${path.relative(rootDir, filePath)}.`);
    }
  }

  const runtimePath = path.join(vendorDir, "ort.min.js");
  if (fs.existsSync(runtimePath)) {
    const runtimeHeader = fs.readFileSync(runtimePath, "utf8").slice(0, 200);
    if (!runtimeHeader.includes("ONNX Runtime Web v1.20.1")) {
      addIssue(issues, "warning", "assets/vendor/ort.min.js does not advertise ONNX Runtime Web v1.20.1.");
    }
  }

  for (const directory of [vendorDir, publicVendorDir]) {
    if (!fs.existsSync(directory)) continue;

    for (const entry of fs.readdirSync(directory)) {
      const filePath = path.join(directory, entry);
      if (entry.endsWith(".wasm")) {
        validateWasmFile(filePath, issues);
      }

      if (entry === "ort-wasm.wasm" || entry === "ort-wasm-simd.wasm") {
        addIssue(
          issues,
          "error",
          `${path.relative(rootDir, filePath)} is a stale ORT fallback filename for v1.20.1 and should not be shipped.`
        );
      }
    }
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
  validateVendorResources(issues);

  if (labels.length !== expectedOseaOutputCount) {
    addIssue(
      issues,
      "warning",
      `bird_info.json contains ${labels.length} labels, but the current OSEA model has been observed returning ${expectedOseaOutputCount} logits. Missing labels should be resolved before claiming full coverage.`
    );
  }

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
