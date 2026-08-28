import asyncio
from io import BytesIO
import shutil
import subprocess
import tempfile
from pathlib import Path

from pypdf import PdfReader

from .config import settings
from .errors import ApiError, ErrorCode


def _extract_text_with_ocr(pdf_bytes: bytes, pages: int) -> list[dict[str, object]]:
    if not settings.pdf_text_ocr_enabled:
        return []
    if not shutil.which("pdftoppm") or not shutil.which("tesseract"):
        return []

    page_count = min(pages, max(1, settings.pdf_text_ocr_max_pages))
    page_texts: list[dict[str, object]] = []
    with tempfile.TemporaryDirectory(prefix="satje_hba_ocr_") as temp_dir:
        temp_path = Path(temp_dir)
        pdf_path = temp_path / "document.pdf"
        pdf_path.write_bytes(pdf_bytes)

        for page_number in range(1, page_count + 1):
            prefix = temp_path / f"page_{page_number}"
            try:
                subprocess.run(
                    [
                        "pdftoppm",
                        "-f",
                        str(page_number),
                        "-l",
                        str(page_number),
                        "-r",
                        str(settings.pdf_text_ocr_dpi),
                        "-png",
                        str(pdf_path),
                        str(prefix),
                    ],
                    check=True,
                    capture_output=True,
                    timeout=30,
                )
                image_candidates = sorted(temp_path.glob(f"page_{page_number}-*.png"))
                if not image_candidates:
                    page_texts.append({"page": page_number, "text": ""})
                    continue
                ocr = subprocess.run(
                    ["tesseract", str(image_candidates[0]), "stdout", "-l", settings.pdf_text_ocr_lang],
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
                page_texts.append({"page": page_number, "text": ocr.stdout.strip()})
            except Exception:
                page_texts.append({"page": page_number, "text": ""})
    return page_texts


def _extract_embedded_text(pdf_bytes: bytes) -> list[dict[str, object]]:
    reader = PdfReader(BytesIO(pdf_bytes))
    # Tope duro de paginas para la via "embedded text": un PDF de hasta 26 MB
    # puede declarar miles de paginas en su arbol; nunca se itera mas alla del
    # limite configurado (C1: DoS por extraccion).
    max_pages = min(len(reader.pages), max(1, settings.pdf_text_max_pages))
    page_texts: list[dict[str, object]] = []
    for page_number in range(1, max_pages + 1):
        page = reader.pages[page_number - 1]
        text = page.extract_text() or ""
        page_texts.append({"page": page_number, "text": text.strip()})
    return page_texts


async def extract_pdf_text(pdf_bytes: bytes) -> dict[str, object]:
    if len(pdf_bytes) > settings.pdf_text_max_bytes:
        raise ApiError(
            ErrorCode.PDF_TEXT_EXTRACTION_ERROR,
            "pdfTextExtraction",
            message="El PDF excede el tamano maximo permitido para extraccion.",
            status_code=422,
        )

    if not pdf_bytes.startswith(b"%PDF"):
        raise ApiError(
            ErrorCode.SATJE_INVALID_RESPONSE,
            "documentHba",
            message="SATJE no devolvio un PDF valido.",
            status_code=502,
        )

    try:
        page_texts, extraction_method = await asyncio.wait_for(
            _extract_text(pdf_bytes),
            timeout=settings.pdf_text_extraction_timeout_seconds,
        )
    except TimeoutError:
        raise ApiError(
            ErrorCode.PDF_TEXT_EXTRACTION_ERROR,
            "pdfTextExtraction",
            message="La extraccion de texto del documento excedio el tiempo maximo permitido.",
            status_code=504,
        ) from None

    return {
        "pages": len(page_texts),
        "text": "\n\n".join(item["text"] for item in page_texts if item["text"]).strip(),
        "pageTexts": page_texts,
        "extractionMethod": extraction_method,
    }


async def _extract_text(pdf_bytes: bytes) -> tuple[list[dict[str, object]], str]:
    # C1: todo el trabajo pesado (parseo pypdf + subprocess de OCR) corre en un
    # thread del executor del loop; el event loop queda libre para el resto de
    # requests. El timeout global lo aplica el caller (wait_for en extract_pdf_text).
    page_texts = await asyncio.to_thread(_extract_embedded_text, pdf_bytes)
    extraction_method = "embedded_text"
    if not any(item["text"] for item in page_texts):
        ocr_page_texts = await asyncio.to_thread(_extract_text_with_ocr, pdf_bytes, len(page_texts))
        if any(item["text"] for item in ocr_page_texts):
            page_texts = ocr_page_texts
            extraction_method = "ocr"
    return page_texts, extraction_method
