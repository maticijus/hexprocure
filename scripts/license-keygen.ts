import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";

const path = process.argv[2];
if (process.argv.length !== 3 || !path) {
  console.error("usage: LICENSE_KEY_PASSPHRASE=... npm run license:keygen -- <private-key-path>");
  process.exit(1);
}

// With LICENSE_KEY_PASSPHRASE set the PKCS#8 file is AES-256 encrypted; without it the key is written in the clear.
const passphrase = process.env.LICENSE_KEY_PASSPHRASE;
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pem = privateKey.export(
  passphrase ? { type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase } : { type: "pkcs8", format: "pem" },
);
try {
  writeFileSync(path, pem, { flag: "wx", mode: 0o600 });
} catch (error) {
  console.error(`cannot write ${path}: ${(error as NodeJS.ErrnoException).code ?? "error"}`);
  process.exit(1);
}
process.stdout.write(publicKey.export({ type: "spki", format: "pem" }));
