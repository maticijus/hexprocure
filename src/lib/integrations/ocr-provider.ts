export interface OcrLine {
  text: string;
  confidence: number;
}

export interface OcrResult {
  text: string;
  lines: OcrLine[];
}

export interface OcrProvider {
  extract(file: Buffer, filename: string): Promise<OcrResult>;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export class PaddleOcrProvider implements OcrProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async extract(file: Buffer, filename: string): Promise<OcrResult> {
    if (file.length === 0) throw new Error("Cannot OCR an empty file");
    if (file.length > MAX_FILE_BYTES) throw new Error("File exceeds the 10 MB OCR limit");

    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(file)], { type: "application/octet-stream" }),
      filename,
    );
    const res = await this.fetchImpl(`${this.baseUrl}/ocr`, { method: "POST", body: form });
    if (!res.ok) {
      throw new Error(`OCR service failed with HTTP ${res.status}`);
    }
    return (await res.json()) as OcrResult;
  }
}
