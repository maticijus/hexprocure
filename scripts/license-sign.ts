import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const TIERS = ["team", "business"];

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    tier: { type: "string" },
    licensee: { type: "string" },
    expires: { type: "string" },
  },
});

const keyPath = process.env.LICENSE_SIGNING_KEY_PATH;
if (!keyPath) fail("LICENSE_SIGNING_KEY_PATH is not set");
if (!values.tier || !TIERS.includes(values.tier)) fail(`--tier must be one of ${TIERS.join(", ")}`);
if (!values.licensee) fail("--licensee is required");
if (!/^\d{4}-\d{2}-\d{2}$/.test(values.expires ?? "")) fail("--expires must be a date such as 2027-10-20");
const expiresMs = Date.parse(`${values.expires}T23:59:59Z`);
if (Number.isNaN(expiresMs) || expiresMs <= Date.now()) fail("--expires must be a valid date in the future");

// The passphrase, if the key file is encrypted, comes from the environment, never from argv.
const privateKey = createPrivateKey({ key: readFileSync(keyPath), passphrase: process.env.LICENSE_KEY_PASSPHRASE });
if (privateKey.asymmetricKeyType !== "ed25519") fail("signing key must be Ed25519");

const b64 = (value: string) => Buffer.from(value).toString("base64url");
const header = b64(JSON.stringify({ alg: "EdDSA", typ: "JWT" }));
const payload = b64(JSON.stringify({ tier: values.tier, licensee: values.licensee, exp: Math.floor(expiresMs / 1000) }));
const signature = sign(null, Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
console.log(`${header}.${payload}.${signature}`);
