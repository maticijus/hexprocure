import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface FileStore {
  put(content: Buffer, filenameHint?: string): Promise<string>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class LocalFileStore implements FileStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async put(content: Buffer, _filenameHint?: string): Promise<string> {
    await mkdir(this.root, { recursive: true });
    void _filenameHint;
    const key = randomUUID();
    await writeFile(join(this.root, key), content);
    return key;
  }

  async get(key: string): Promise<Buffer> {
    try {
      return await readFile(join(this.root, key));
    } catch {
      throw new Error(`File not found for key: ${key}`);
    }
  }

  async delete(key: string): Promise<void> {
    await unlink(join(this.root, key)).catch(() => {});
  }
}
