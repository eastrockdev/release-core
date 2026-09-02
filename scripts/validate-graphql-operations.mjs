import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { parse } from "graphql";

const appDirectory = path.resolve("app");
const sourceFiles = [];

function collectSourceFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      collectSourceFiles(filePath);
    } else if (/\.(?:js|jsx)$/.test(entry.name)) {
      sourceFiles.push(filePath);
    }
  }
}

collectSourceFiles(appDirectory);

const failures = [];
let operationCount = 0;

for (const filePath of sourceFiles) {
  const source = fs.readFileSync(filePath, "utf8");
  const operationPattern = /admin\.graphql\(\s*`([\s\S]*?)`/g;
  let match;

  while ((match = operationPattern.exec(source))) {
    operationCount += 1;

    try {
      parse(match[1]);
    } catch (error) {
      const line = source.slice(0, match.index).split("\n").length;
      failures.push(`${path.relative(process.cwd(), filePath)}:${line}: ${error.message}`);
    }
  }
}

if (failures.length) {
  console.error("Invalid inline Admin GraphQL operations:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Validated ${operationCount} inline Admin GraphQL operations.`);
