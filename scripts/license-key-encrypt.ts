import { createPrivateKey } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";

// Encrypts an existing Ed25519 signing key in place (macOS LibreSSL cannot).
// usage: LICENSE_KEY_PASSPHRASE=... npm run license:encrypt -- <private-key-path>
const path = process.argv[2];
const passphrase = process.env.LICENSE_KEY_PASSPHRASE;
if (process.argv.length !== 3 || !path || !passphrase) {
  console.error("usage: LICENSE_KEY_PASSPHRASE=... npm run license:encrypt -- <private-key-path>");
  process.exit(1);
}

const key = createPrivateKey(readFileSync(path));
if (key.asymmetricKeyType !== "ed25519") {
  console.error("not an Ed25519 key");
  process.exit(1);
}
writeFileSync(`${path}.tmp`, key.export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase }), { mode: 0o600 });
renameSync(`${path}.tmp`, path);
console.log(`encrypted ${path}`);
