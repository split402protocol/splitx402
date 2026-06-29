import {
  PRODUCT_PUBLIC_SURFACE_CHECK_USAGE,
  createSplit402PublicSurfaceCheckReport,
  formatSplit402PublicSurfaceCheckBrief,
  serializeSplit402PublicSurfaceCheckReport,
} from "./productPublicSurfaceCheck.js";

const { brief, help, json } = readCliArgs();

if (help) {
  console.log(PRODUCT_PUBLIC_SURFACE_CHECK_USAGE);
  process.exit(0);
}

const report = createSplit402PublicSurfaceCheckReport();
console.log(
  json && !brief
    ? serializeSplit402PublicSurfaceCheckReport(report)
    : formatSplit402PublicSurfaceCheckBrief(report),
);

if (!report.ok) {
  process.exitCode = 1;
}

function readCliArgs(): {
  brief: boolean;
  help: boolean;
  json: boolean;
} {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

function parseArgs(args: readonly string[]): {
  brief: boolean;
  help: boolean;
  json: boolean;
} {
  let brief = false;
  let help = false;
  let json = false;

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--brief") {
      brief = true;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`${PRODUCT_PUBLIC_SURFACE_CHECK_USAGE}\nUnknown option: ${arg}`);
    }
  }

  return { brief, help, json };
}
