import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";

const path = process.argv[2];
if (process.argv.length !== 3 || !path) {
  console.error("usage: npm run license:keygen -- <private-key-path>");
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
try {
  writeFileSync(path, privateKey.export({ type: "pkcs8", format: "pem" }), { flag: "wx", mode: 0o600 });
} catch (error) {
  console.error(`cannot write ${path}: ${(error as NodeJS.ErrnoException).code ?? "error"}`);
  process.exit(1);
}
process.stdout.write(publicKey.export({ type: "spki", format: "pem" }));
