"""PaddleOCR sidecar: exposes POST /ocr for the HexProcure app.

Accepts an image or PDF, returns plain text plus per-line confidence.
Run standalone:  uvicorn main:app --port 8100
Or via Docker:   docker build -t hexprocure-ocr . && docker run -p 8100:8100 hexprocure-ocr
"""
import io
import os

from fastapi import FastAPI, HTTPException, UploadFile
from pydantic import BaseModel

app = FastAPI(title="HexProcure OCR sidecar")

MAX_BYTES = 10 * 1024 * 1024
_engine = None


def get_engine():
    global _engine
    if _engine is None:
        from paddleocr import PaddleOCR

        _engine = PaddleOCR(use_angle_cls=True, lang="en", show_log=False)
    return _engine


class OcrLine(BaseModel):
    text: str
    confidence: float


class OcrResponse(BaseModel):
    text: str
    lines: list[OcrLine]


def pdf_to_images(data: bytes) -> list[bytes]:
    import fitz  # PyMuPDF

    doc = fitz.open(stream=data, filetype="pdf")
    images = []
    for page in doc:
        pix = page.get_pixmap(dpi=200)
        images.append(pix.tobytes("png"))
    doc.close()
    return images


@app.post("/ocr", response_model=OcrResponse)
async def ocr(file: UploadFile) -> OcrResponse:
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "File exceeds 10 MB limit")

    filename = file.filename or ""
    try:
        if filename.lower().endswith(".pdf"):
            images = pdf_to_images(data)
        else:
            images = [data]
    except Exception as exc:  # noqa: BLE001 - surface any parse failure to caller
        raise HTTPException(422, f"Could not read file: {exc}") from exc

    engine = get_engine()
    lines: list[OcrLine] = []
    for image in images:
        result = engine.ocr(image, cls=True)
        for page in result or []:
            for entry in page or []:
                box_text, (raw_text, conf) = entry[1][0], entry[1]
                lines.append(OcrLine(text=raw_text, confidence=float(conf)))

    text = "\n".join(line.text for line in lines)
    return OcrResponse(text=text, lines=lines)
