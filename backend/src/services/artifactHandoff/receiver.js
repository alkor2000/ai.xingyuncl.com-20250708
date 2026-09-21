// Development seam only. No Identity client, network URL, or real TE-DNA write.
const { randomUUID } = require('crypto');
const { digest, fail } = require('./source');
const { validUUID } = require('./selection');
const TARGET = 'mock-tedna';
const RECEIPT_VERSION = 'p03-mock-receipt/1';

function delivery(record) {
  // Hash the exact UTF-8 transport bytes, never the ZIP or a receiver's reserialization.
  const packetBytes = Buffer.from(JSON.stringify({ manifest: record.manifest, payload: record.payload }));
  const binding = { operation_id: record.operation_id || record.id, snapshot_id: record.id,
    receiver: TARGET, packet_sha256: digest(packetBytes) };
  return { binding, packetBytes, expires_at: record.expires_at };
}

function validateReceipt(receipt, binding, now) {
  if (!receipt || receipt.receipt_version !== RECEIPT_VERSION || receipt.simulated !== true ||
      receipt.persistence !== 'durable' || receipt.visibility !== 'private' ||
      !validUUID(receipt.receipt_id) || !validUUID(receipt.resource_id) ||
      !/^sha256:[a-f0-9]{64}$/.test(receipt.resource_version) ||
      !Number.isSafeInteger(receipt.accepted_at) || receipt.accepted_at < 0 || receipt.accepted_at > Math.floor(now / 1000) ||
      Object.entries(binding).some(([key, value]) => receipt[key] !== value)) fail('receipt_invalid', 502, true);
  // Whitelist the response; a receiver-supplied URL, account ID or extra data never becomes a landing.
  return { receipt_version: RECEIPT_VERSION, ...binding, receipt_id: receipt.receipt_id,
    resource_id: receipt.resource_id, resource_version: receipt.resource_version,
    accepted_at: receipt.accepted_at, persistence: 'durable', visibility: 'private', simulated: true };
}

class MockArtifactReceiver {
  constructor({ store, now = Date.now }) { Object.assign(this, { store, now }); }
  async lookup(binding) {
    return this.store.transaction(state => {
      const item = state.received[binding.operation_id];
      if (!item) return null;
      return validateReceipt(item.receipt, binding, this.now());
    });
  }
  async accept({ binding, packetBytes, expires_at }, simulation) {
    if (digest(packetBytes) !== binding.packet_sha256) fail('receipt_invalid', 502);
    if (simulation === 'reject') fail('receiver_unavailable', 503, true);
    const receipt = await this.store.transaction(state => {
      const previous = state.received[binding.operation_id];
      if (previous) return validateReceipt(previous.receipt, binding, this.now());
      const receipt = { receipt_version: RECEIPT_VERSION, ...binding, receipt_id: randomUUID(),
        resource_id: randomUUID(), resource_version: `sha256:${binding.packet_sha256}`,
        accepted_at: Math.floor(this.now() / 1000), persistence: 'durable', visibility: 'private', simulated: true };
      state.received[binding.operation_id] = { receipt, packet: JSON.parse(packetBytes.toString('utf8')), expires_at };
      return receipt;
    });
    // This happens AFTER the separate receiver spool has fsynced, emulating a lost response.
    if (simulation === 'lose_response') fail('response_lost', 503, true);
    return receipt;
  }
}
module.exports = { TARGET, delivery, validateReceipt, MockArtifactReceiver };
