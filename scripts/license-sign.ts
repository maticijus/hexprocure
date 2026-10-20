import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const TIERS = ["community", "team", "business"];

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    tier: { type: "string" },
    licensee: { type: "string" },
    expires: { type: "string" },
    "ai-docs": { type: "string", default: "0" },
    connectors: { type: "string", default: "" },
  },
});

const keyPath = process.env.LICENSE_SIGNING_KEY_PATH;
if (!keyPath) fail("LICENSE_SIGNING_KEY_PATH is not set");
if (!values.tier || !TIERS.includes(values.tier)) fail(`--tier must be one of ${TIERS.join(", ")}`);
if (!values.licensee) fail("--licensee is required");
const expiresMs = Date.parse(values.expires ?? "");
if (Number.isNaN(expiresMs)) fail("--expires must be a date such as 2027-10-20");
const aiDocs = Number(values["ai-docs"]);
if (!Number.isInteger(aiDocs) || aiDocs < 0) fail("--ai-docs must be a non-negative integer");

const b64 = (value: string) => Buffer.from(value).toString("base64url");
const header = b64(JSON.stringify({ alg: "EdDSA", typ: "JWT" }));
const payload = b64(
  JSON.stringify({
    tier: values.tier,
    licensee: values.licensee,
    exp: Math.floor(expiresMs / 1000),
    aiDocsPerMonth: aiDocs,
    connectors: values.connectors ? values.connectors.split(",").map((c) => c.trim()).filter(Boolean) : [],
  }),
);
const signature = sign(null, Buffer.from(`${header}.${payload}`), createPrivateKey(readFileSync(keyPath))).toString("base64url");
console.log(`${header}.${payload}.${signature}`);
