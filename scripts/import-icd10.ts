
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();

const FISCAL_YEAR = 2027;
const VALID_FROM = new Date("2026-10-01T00:00:00.000Z");
const VALID_THROUGH = new Date("2027-09-30T23:59:59.999Z");
const BATCH_SIZE = 1000;

const folder = path.join(
  process.cwd(),
  "data",
  "icd10",
  "fy2027",
  "icd10cm-code-descriptions-2027"
);

function loadCatalog() {
  const codesPath = path.join(folder, "icd10cm-codes-2027.txt");
  const orderPath = path.join(folder, "icd10cm-order-2027.txt");

  if (!fs.existsSync(codesPath) || !fs.existsSync(orderPath)) {
    throw new Error("Required FY2027 CDC ICD-10 files were not found.");
  }

  const codeLines = fs.readFileSync(codesPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean);

  const orderLines = fs.readFileSync(orderPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean);

  const descriptions = new Map<string, string>();

  for (const line of codeLines) {
    const match = line.match(/^([A-Z0-9]{3,7})\s+(.+)$/);

    if (!match) {
      throw new Error(`Invalid diagnosis description row: ${line}`);
    }

    const code = match[1];
    const description = match[2].trim();

    if (descriptions.has(code)) {
      throw new Error(`Duplicate diagnosis code in source: ${code}`);
    }

    descriptions.set(code, description);
  }

  const billableCodes = new Set<string>();

  for (const line of orderLines) {
    const match = line.match(
      /^\s*(\d{5})\s+([A-Z0-9]{3,7})\s+([01])\s+(.+)$/
    );

    if (!match) {
      throw new Error(`Invalid ICD-10 order row: ${line}`);
    }

    const code = match[2];
    const billableIndicator = match[3];

    if (billableIndicator === "1") {
      billableCodes.add(code);
    }
  }

  const missing = [...descriptions.keys()].filter(
    (code) => !billableCodes.has(code)
  );

  const extra = [...billableCodes].filter(
    (code) => !descriptions.has(code)
  );

  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `Catalog validation failed. Missing billable entries: ${missing.length}; ` +
      `billable codes without descriptions: ${extra.length}.`
    );
  }

  return [...descriptions.entries()].map(([code, description]) => ({
    code,
    description,
    fiscalYear: FISCAL_YEAR,
    billable: true,
    validFrom: VALID_FROM,
    validThrough: VALID_THROUGH,
    isActive: true,
  }));
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const records = loadCatalog();

  console.log(`FY${FISCAL_YEAR} diagnosis records validated: ${records.length}`);

  const existing = await prisma.diagnosisCode.count({
    where: { fiscalYear: FISCAL_YEAR },
  });

  console.log(`Existing FY${FISCAL_YEAR} records: ${existing}`);

  if (dryRun) {
    console.log("DRY RUN: No database records were changed.");
    return;
  }

  let processed = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    await prisma.diagnosisCode.createMany({
      data: batch,
      skipDuplicates: true,
    });

    processed += batch.length;
    console.log(`Validated and processed: ${processed}/${records.length}`);
  }

  const finalCount = await prisma.diagnosisCode.count({
    where: { fiscalYear: FISCAL_YEAR },
  });

  console.log("\nICD-10 import completed.");
  console.log(`Records processed: ${processed}`);
  console.log(`Records before import: ${existing}`);
  console.log(`Records after import: ${finalCount}`);
  console.log(`Net records added: ${finalCount - existing}`);
}

main()
  .catch((error) => {
    console.error("ICD-10 import failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });