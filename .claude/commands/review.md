Run an AI code review of the working tree vs main using OpenCodeReview:

1. `ocr review --from main --format json --output /tmp/ocr-review.json`
2. If no LLM is configured for OCR, fall back to delegation:
   `ocr delegate preview`, then apply `ocr delegate rule` on changed TypeScript files
   and review those rules against the diff yourself.
3. Summarize findings grouped by severity. For each finding, verify it against the
   actual code before reporting — discard false positives with a stated reason.
4. Fix confirmed real defects; leave style-only nits as suggestions.

Never self-approve: end by listing what changed as a result of this review.
