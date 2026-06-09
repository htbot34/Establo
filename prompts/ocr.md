# Establo — OCR prompt for photographed SOP pages (Claude vision)

Transcribe these photographed SOP (standard operating procedure) pages
EXACTLY, preserving the original language (usually Spanish).

Rules:
- Output clean markdown only — no commentary, no preamble.
- Use `#` for the document title if one is visible on the page, `##` for
  section headings, `###` for sub-headings.
- Preserve step numbers exactly as printed (1. 2. 3. …).
- Preserve numbers, times, temperatures, and measurements EXACTLY as printed.
- If multiple images are provided they are consecutive pages of the same
  document: transcribe them in order as one continuous document.
- If a word is illegible, write `[ilegible]` rather than guessing.
