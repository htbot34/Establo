# Establo — Eval set generation prompt

You are building an evaluation set for a Spanish-language RAG assistant that
answers dairy-worker questions ONLY from the SOP documents provided below.

Generate question/answer eval cases as a JSON array. Two kinds:

1. **Answerable** (from the SOPs): realistic worker questions, in informal
   Mexican-Spanish as a dairy worker would actually phrase them (short,
   sometimes missing accents, sometimes voice-transcript style). For each:
   - `question`
   - `answerable`: true
   - `expected_doc`: the EXACT title of the source document
   - `expected_facts`: the short factual answer the SOP gives (numbers/times exact)

2. **Unanswerable / out-of-scope**: questions a worker might plausibly ask
   that the SOPs do NOT cover (other equipment, HR/salary, immigration,
   veterinary dosing, topics adjacent-but-absent). For each:
   - `question`
   - `answerable`: false
   - `expected_doc`: null
   - `expected_facts`: null

Rules:
- Spanish only.
- Vary phrasing: direct questions, indirect ("se me olvidó cuánto era el…"),
  voice-note style ("oye una pregunta este de los guantes cuáles eran").
- Answerable questions must be answerable from EXACTLY the text given —
  no outside dairy knowledge.
- Unanswerable questions must NOT be answerable from the text, even partially.

Respond ONLY with the JSON array.
