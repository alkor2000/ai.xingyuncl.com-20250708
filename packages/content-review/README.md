# content-review 0.1.0 — shared candidate library

Independent Node 18+ ES-module library; no dependencies and no platform database or authorization side effects. This is the **shared-library option** in task A, not a deployed HTTP service. EDU (Node) imports it directly; TE (Go) can invoke a small authenticated internal adapter using this same pinned package, without reimplementing policy. That adapter and platform integration remain platform tasks B/C. Do not expose an unauthenticated review endpoint or let clients submit trusted review results.

Policy: `docs/审查标准.md`, version `2026-11-10.1`. The delivery document at `D:\TeachingWorkspace\给本人\内容审查标准-20261110\审查标准.md` and this repository copy have identical bytes. `standard-reference.json` records the version/hash for platform consumers. Seven classes are the original six with expanded political scope and a dedicated map class.

```js
import { createReviewer } from '@pkuailab/content-review';
import { createOpenAIAdapter } from '@pkuailab/content-review/openai-adapter';
// Obtain these from your EXISTING server-side approved model configuration.
// Never expose configuration or provider errors to the browser.
const textModel = createOpenAIAdapter({endpoint, apiKey, model});
const visionModel = createOpenAIAdapter(existingVisionConfig);
const review = createReviewer({textModel, visionModel, modelRevision: configRevision});
const result = await review({
  platform: 'edu', kind: 'text', text: '分数加法练习', images: []
});
// result: decision (allow/reject/review), categories, safe generic reasons,
// checks, policyVersion, policySha256, modelRevision, contentSha256, checkedAt
```

Adapters receive `{system, text, images, maxOutputTokens, signal}` and return `{decision, scores: {sexual, violence, disgust, discrimination, political, minors, map}, mapDetected}`. Scores must all be finite 0–1 values. Existing non-OpenAI/Azure/proxy adapters can implement this function contract; the supplied adapter supports an explicitly configured OpenAI-compatible chat-completions HTTPS endpoint only. It does not invent a new provider or scan model/credential databases. It denies redirects and URL credentials, sends base64 image data rather than fetching arbitrary URLs, limits response bytes and rejects truncated model completions. The caller must verify and approve the endpoint; arbitrary externally supplied endpoints are forbidden.

Input: `kind=text|image|video|document`; `platform=practice|edu|te`; text ≤12,000 characters; `images` is required (possibly empty), up to 8 still JPEG/PNG/WebP images, each canonical base64 with matching file signature and ≤2,800,000 encoded characters. Full safe image decoding, animation detection, resolution limits, complete OCR and document extraction are the host's responsibility; header checks are not a full image sanitizer. An animated image must be sampled through the video flow or manually reviewed. Document requests require `extractionComplete:true` from a **trusted server extractor**, never from the student/author/browser. Large documents must be reviewed in complete batches; any missing batch keeps the whole document in review. Do not truncate to pass limits.

Video requests use `images:[]` and `video:{sha256,durationSeconds,frames:[{mime,base64,timeSeconds},…]}`. Require 5–8 ordered frames, first ≤5%, last ≥95%, no gap >30% of duration. Hosts extract frames from the exact file indicated by sha256; callers may not supply a different file after review. Frame sampling is not full-video certification. Extract/review audio transcripts too or keep the video pending manual review. No ffmpeg process, uploaded-file parser or remote URL fetch is started by this library.

Rules: exact prohibited phrases reject before paid inference; map mentions/detection force manual review even if model says allow. Clear other-category rejection wins over map review. Scores ≥0.85 reject (except map), ≥0.35 review. Missing model, timeout, malformed JSON, incomplete document or invalid media fails to review. A request may make at most 2 calls (text then visual); reject short-circuits. Default per-call deadline 30s (up to 60s); configured adapters must honor AbortSignal. Maximum combined inference wait is 2×deadline.

Integration security: the result is **not a bearer authorization token**. Only trusted server code may consume it. Store it in an authenticated queue with actor, resource ID/revision, full original content/attachment digest, policy digest and model config revision. Use a conditional transaction when expanding visibility; mismatch or policy/model upgrade invalidates approval. Human map verification belongs in that queue with reviewer identity, timestamp and evidence. Do not let an author send `allow` or `standard_map=true`. Takedown must block share links and media/CDN access, not merely gallery listings. Never auto-delete existing works. No automatic backfill writes exist in this package.

Validation:

- `npm test`: isolated tests with controlled model fixtures; these prove control flow/contracts, NOT semantic model accuracy.
- `npm run benchmark -- --out=/private/dry.json`: enumerates 48 authored prompt cases without model calls. 20 reject, 20 normal, 8 review (including 6 maps).
- After approval, configure an **existing** endpoint/model via private environment variables `CONTENT_REVIEW_ENDPOINT`, `CONTENT_REVIEW_API_KEY`, `CONTENT_REVIEW_MODEL`, `CONTENT_REVIEW_MODEL_REVISION`; set `CONTENT_REVIEW_BENCHMARK_APPROVED=yes` and add `--live`. Never put credentials in command arguments or repository files. No live benchmark was run for this candidate. A model with unknown vision capability must not be used for visual review.

The benchmark measures prompt cases only, not image/frame detection or production reliability. Publication readiness additionally requires independent review, real model prompt evaluation (all reject cases blocked, ≥95% normal allowed), real map/non-map pixel cases, server extraction and shared-link enforcement tests. Until those pass, keep integration in manual-review/shadow mode. No production activation, paid new service, model call, historical hiding or feedback status change is part of this candidate.
