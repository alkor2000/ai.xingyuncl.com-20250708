const { encodeDraft, bindingHash, selectionHash } = require('../../../services/artifactHandoff/i03Draft');

// Published synthetic vector: Identity dev/i03/fixtures.json, i03-draft-0.1 (2026-09-19).
// Kept here so the test is independent of another checkout or live Identity service.
function sample() {
  const source = { platform: 'practice', kind: 'assistant_message', object_id: 'a0300000-0000-4000-8000-000000000001',
    conversation_id: 'a0300000-0000-4000-8000-000000000003',
    version: 'sha256:ffe2dc94c5e8b9c71a8968bc3a320d55ad07964a77e874fb3faac530c78733e1', generated_at: 1789815600, model_name: null };
  return { id: '10300000-0000-4000-8000-000000000002', binding: { operation_id: '10300000-0000-4000-8000-000000000001' },
    manifest: { source, locator: { basis: 'answer_without_thinking_utf16', start: 23, end: 37 }, purpose: 'reference',
      visibility: 'private', material_status: 'ai_output_unreviewed', summary: { text: 'DO_NOT_SEND_TO_IDENTITY' } },
    payload: { text: '先观察，再记录两杯水的变化。', attachments: [{ source_id: 'a0300000-0000-4000-8000-000000000004',
      name: 'activity.md', format: 'text/markdown', byte_length: 58,
      version: 'sha256:9f8492116085df1855ab5b5735f52eaae1a56eb6ba4253eb2cc576c51d374778',
      text: '# 合成材料\n让学生观察两杯水的蒸发现象。\n' }] } };
}
const options = { sourceInstance: 'practice-synthetic', targetInstance: 'tedna-synthetic', title: '两杯水观察方案（合成）' };
test('Node source encoder matches independent Identity Python/Go golden byte and framing vectors', () => {
  const output = encodeDraft(sample(), options);
  expect(output.binding.manifest_sha256).toBe('b0e470002fe6858e4395b8267238b1fe665fccb6af01141fda57ad5ff7da27cd');
  expect(output.binding.selection_sha256).toBe('5bae9fb31c0ca861c4d71f60420a91ce8086b63f4e16bad50e4d835da0e6d10f');
  expect(output.binding_sha256).toBe('2e3bb47ddb4218858adacb25924460099afc4ab70a55e3bd667528056ed5e939');
  expect(output.binding.byte_length).toBe(100);
  const manifest = JSON.parse(Buffer.from(output.package.manifest_b64, 'base64'));
  expect(manifest.blobs[0].sha256).toBe('8d1c6778ce308befc023e90d1e9bb4fc1451174d2dfbf6aec4e0415d6f141ee1');
  expect(manifest.blobs[1].sha256).toBe('9f8492116085df1855ab5b5735f52eaae1a56eb6ba4253eb2cc576c51d374778');
  expect(Buffer.from(output.package.blobs[0].data_b64, 'base64').toString()).toBe(sample().payload.text);
  expect(JSON.stringify(output.binding)).not.toMatch(/两杯|合成|摘要|text|title|local_account|global_person/);
  expect(JSON.stringify(manifest)).not.toContain('DO_NOT_SEND_TO_IDENTITY');
});
test('purpose/operation change keeps selection identity but changes complete binding', () => {
  const input = sample(), original = encodeDraft(input, options);
  input.manifest.purpose = 'lesson_preparation';
  input.binding.operation_id = '10300000-0000-4000-8000-000000000003';
  const other = encodeDraft(input, options);
  expect(other.binding.selection_sha256).toBe(original.binding.selection_sha256);
  expect(other.binding_sha256).not.toBe(original.binding_sha256);
  const manifest = JSON.parse(Buffer.from(other.package.manifest_b64, 'base64'));
  manifest.source.instance = 'another-instance';
  expect(selectionHash(manifest)).not.toBe(other.binding.selection_sha256);
  expect(bindingHash({ ...other.binding, landing: 'courseware' })).not.toBe(other.binding_sha256);
});
test.each([
  x => { x.payload.text = '\ud800'.repeat(14); },
  x => { x.payload.text = '\0'.repeat(14); },
  x => { x.payload.attachments[0].name = '../private.txt'; },
  x => { x.payload.attachments[0].text += 'altered'; },
  x => { x.payload.attachments.push(x.payload.attachments[0]); },
  x => { x.payload.attachments[0].format = 'text/html'; },
  x => { x.manifest.locator.end++; },
  x => { x.manifest.source.generated_at = -1; }
])('rejects invalid or mismatched frozen content before producing a draft package', mutate => {
  const input = sample(); mutate(input);
  expect(() => encodeDraft(input, options)).toThrow('invalid_draft_package');
});
