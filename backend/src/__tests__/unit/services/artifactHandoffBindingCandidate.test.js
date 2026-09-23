// The instance-binding candidate document must agree with the pinned HTTPS trust and stay disabled.
const candidate = require('../../../../../docs/integrations/p03-instance-binding-candidate.json');
const { TRUST } = require('../../../services/artifactHandoff/i03HttpsTransport');
const { FORMAL_VERSION } = require('../../../services/artifactHandoff/i03Draft');
describe('P03 instance binding candidate', () => {
  const pku = candidate.sites.pku, env = candidate.env_candidate_pku;
  test('matches the pinned deployment trust and the formal wire', () => {
    expect(candidate).toMatchObject({ schema_version: 1, status: 'candidate_not_deployed' });
    expect(pku).toMatchObject({ public_origin: TRUST.sourceOrigin, identity_issuer: TRUST.identityOrigin, client_id: TRUST.clientId,
      deployment_instance_key: TRUST.sourceInstance });
    expect(pku.handoff).toMatchObject({ source_instance: TRUST.sourceInstance, target_instance: TRUST.targetInstance,
      target_origin: TRUST.targetOrigin, wire_version: FORMAL_VERSION });
    expect(env).toMatchObject({ IDENTITY_DEPLOYMENT_INSTANCE_KEY: TRUST.sourceInstance, P03_HANDOFF_SOURCE_INSTANCE: TRUST.sourceInstance,
      P03_HANDOFF_TARGET_INSTANCE: TRUST.targetInstance, P03_HANDOFF_IDENTITY_ORIGIN: TRUST.identityOrigin,
      P03_HANDOFF_TARGET_ORIGIN: TRUST.targetOrigin, P03_HANDOFF_WIRE_VERSION: FORMAL_VERSION });
  });
  test('stays disabled on both sites and uses a valid enrollment instance key shape', () => {
    expect(pku.handoff.enabled).toBe(false);
    expect(candidate.sites.xingyun.handoff.enabled).toBe(false);
    expect(env.P03_HANDOFF_ENABLED).toBe('false');
    expect(env.IDENTITY_DEPLOYMENT_INSTANCE_KEY).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/); // identityEnrollmentRuntimeConfig rule
    expect(JSON.stringify(candidate)).not.toMatch(/secret|password|ticket=/i);
  });
});
