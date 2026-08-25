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


def extract_pdf_text(pdf_bytes: bytes) -> dict[str, object]:
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
        reader = PdfReader(BytesIO(pdf_bytes))
        page_texts = []
        for index, page in enumerate(reader.pages, start=1):
            text = page.extract_text() or ""
            page_texts.append({"page": index, "text": text.strip()})
    except Exception as exc:
        raise ApiError(ErrorCode.PDF_TEXT_EXTRACTION_ERROR, "pdfTextExtraction", status_code=422) from exc

    extraction_method = "embedded_text"
    if not any(item["text"] for item in page_texts):
        ocr_page_texts = _extract_text_with_ocr(pdf_bytes, len(page_texts))
        if any(item["text"] for item in ocr_page_texts):
            page_texts = ocr_page_texts
            extraction_method = "ocr"

    return {
        "pages": len(page_texts),
        "text": "\n\n".join(item["text"] for item in page_texts if item["text"]).strip(),
        "pageTexts": page_texts,
        "extractionMethod": extraction_method,
    }
