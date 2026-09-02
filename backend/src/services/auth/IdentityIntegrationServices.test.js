const crypto = require('crypto');

const {
  IdentityFlowService
} = require('./IdentityFlowService');

const {
  IdentityOIDCService
} = require('./IdentityOIDCService');

class FakeRedis {
  constructor() {
    this.isConnected = true;
    this.values = new Map();
  }

  async setIfAbsent(
    key,
    value
  ) {
    if (this.values.has(key)) {
      return false;
    }

    this.values.set(
      key,
      JSON.parse(JSON.stringify(value))
    );

    return true;
  }

  async getDel(key) {
    if (!this.values.has(key)) {
      return null;
    }

    const value =
      this.values.get(key);

    this.values.delete(key);

    return JSON.parse(
      JSON.stringify(value)
    );
  }
}

function buildIdentityConfig(overrides = {}) {
  return {
    enabled: true,
    issuer: 'https://id.pkuailab.com',
    clientId: 'ai-platform-client',
    clientSecret:
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    tokenAuthMethod: 'client_secret_post',

    loginRedirectUri:
      'https://ai.xingyuncl.com/api/auth/identity/login/callback',

    bindRedirectUri:
      'https://ai.xingyuncl.com/api/auth/identity/callback',

    scopes: [
      'openid',
      'profile',
      'platform_link'
    ],

    flowTtlSeconds: 600,
    handoffTtlSeconds: 90,
    httpTimeoutMs: 10000,
    jwksCacheSeconds: 300,

    ...overrides
  };
}

function signIdentityJWT({
  privateKey,
  kid,
  nonce,
  subject =
    '55a8827b-06af-47de-a3b0-743fd889711e'
}) {
  const now =
    Math.floor(Date.now() / 1000);

  const header = {
    alg: 'EdDSA',
    typ: 'JWT',
    kid
  };

  const payload = {
    iss: 'https://id.pkuailab.com',
    sub: subject,
    aud: 'ai-platform-client',
    iat: now,
    exp: now + 300,
    nonce
  };

  const encodedHeader =
    Buffer
      .from(JSON.stringify(header))
      .toString('base64url');

  const encodedPayload =
    Buffer
      .from(JSON.stringify(payload))
      .toString('base64url');

  const signingInput =
    `${encodedHeader}.${encodedPayload}`;

  const signature =
    crypto.sign(
      null,
      Buffer.from(signingInput, 'ascii'),
      privateKey
    );

  return `${signingInput}.${signature.toString('base64url')}`;
}

describe(
  'IdentityFlowService',
  () => {
    test(
      'login flow使用PKCE且只能消费一次',
      async () => {
        const redis =
          new FakeRedis();

        const service =
          new IdentityFlowService({
            redis,
            identityConfig:
              buildIdentityConfig()
          });

        const flow =
          await service.createFlow({
            purpose: 'login',
            returnTo:
              '/wiki?source=portal'
          });

        expect(flow.state)
          .toMatch(
            /^[A-Za-z0-9_-]{43}$/
          );

        expect(flow.nonce)
          .toMatch(
            /^[A-Za-z0-9_-]{43}$/
          );

        expect(flow.codeChallenge)
          .toMatch(
            /^[A-Za-z0-9_-]{43}$/
          );

        expect(flow.codeChallengeMethod)
          .toBe('S256');

        const consumed =
          await service.consumeFlow(
            flow.state
          );

        expect(consumed.purpose)
          .toBe('login');

        expect(consumed.returnTo)
          .toBe('/wiki?source=portal');

        await expect(
          service.consumeFlow(flow.state)
        ).rejects.toMatchObject({
          code:
            'IDENTITY_FLOW_EXPIRED'
        });
      }
    );

    test(
      'bind flow固定保存String(users.id)',
      async () => {
        const redis =
          new FakeRedis();

        const service =
          new IdentityFlowService({
            redis,
            identityConfig:
              buildIdentityConfig()
          });

        const flow =
          await service.createFlow({
            purpose: 'bind',
            localUserId: 128,
            returnTo: '/profile'
          });

        const consumed =
          await service.consumeFlow(
            flow.state
          );

        expect(consumed.localUserId)
          .toBe('128');
      }
    );

    test(
      'return_to拒绝外部URL',
      () => {
        expect(() =>
          IdentityFlowService
            .normalizeReturnTo(
              'https://evil.example/path'
            )
        ).toThrow();

        expect(() =>
          IdentityFlowService
            .normalizeReturnTo(
              '//evil.example/path'
            )
        ).toThrow();
      }
    );

    test(
      'handoff只能消费一次',
      async () => {
        const redis =
          new FakeRedis();

        const service =
          new IdentityFlowService({
            redis,
            identityConfig:
              buildIdentityConfig()
          });

        const handoff =
          await service.createHandoff({
            userId: 321,
            returnTo: '/dashboard'
          });

        const first =
          await service.consumeHandoff(
            handoff.ticket
          );

        expect(first.userId)
          .toBe('321');

        await expect(
          service.consumeHandoff(
            handoff.ticket
          )
        ).rejects.toMatchObject({
          code:
            'IDENTITY_HANDOFF_EXPIRED'
        });
      }
    );
  }
);

describe(
  'IdentityOIDCService',
  () => {
    test(
      'Authorization URL冻结Client、Host、Scope和PKCE',
      () => {
        const service =
          new IdentityOIDCService({
            identityConfig:
              buildIdentityConfig(),
            httpClient: {}
          });

        const token =
          'A'.repeat(43);

        const url =
          new URL(
            service
              .buildAuthorizationURL({
                state: token,
                nonce: token,
                codeChallenge: token,
                purpose: 'login'
              })
          );

        expect(url.origin)
          .toBe(
            'https://id.pkuailab.com'
          );

        expect(url.pathname)
          .toBe('/oauth/authorize');

        expect(
          url.searchParams.get(
            'client_id'
          )
        ).toBe(
          'ai-platform-client'
        );

        expect(
          url.searchParams.get(
            'redirect_uri'
          )
        ).toBe(
          'https://ai.xingyuncl.com/api/auth/identity/login/callback'
        );

        expect(
          url.searchParams.get('scope')
        ).toBe(
          'openid profile platform_link'
        );

        expect(
          url.searchParams.get(
            'code_challenge_method'
          )
        ).toBe('S256');
      }
    );

    test(
      'Ed25519 ID Token严格通过JWKS验签并校验nonce',
      async () => {
        const {
          publicKey,
          privateKey
        } =
          crypto.generateKeyPairSync(
            'ed25519'
          );

        const publicJWK =
          publicKey.export({
            format: 'jwk'
          });

        const kid =
          'ed25519-test-key';

        const nonce =
          crypto
            .randomBytes(32)
            .toString('base64url');

        const idToken =
          signIdentityJWT({
            privateKey,
            kid,
            nonce
          });

        const fakeHTTP = {
          get: jest.fn(
            async (url) => {
              if (
                url.endsWith(
                  '/.well-known/jwks.json'
                )
              ) {
                return {
                  data: {
                    keys: [
                      {
                        ...publicJWK,
                        kid,
                        use: 'sig',
                        alg: 'EdDSA'
                      }
                    ]
                  }
                };
              }

              throw new Error(
                'unexpected GET'
              );
            }
          )
        };

        const service =
          new IdentityOIDCService({
            identityConfig:
              buildIdentityConfig(),
            httpClient: fakeHTTP
          });

        const claims =
          await service.verifyIDToken(
            idToken,
            nonce
          );

        expect(claims.sub)
          .toBe(
            '55a8827b-06af-47de-a3b0-743fd889711e'
          );

        await expect(
          service.verifyIDToken(
            idToken,
            'B'.repeat(43)
          )
        ).rejects.toMatchObject({
          code:
            'IDENTITY_ID_TOKEN_INVALID'
        });
      }
    );

    test(
      'UserInfo必须与ID Token subject一致且platform_link结构正确',
      async () => {
        const subject =
          '55a8827b-06af-47de-a3b0-743fd889711e';

        const fakeHTTP = {
          get: jest.fn(
            async () => ({
              data: {
                sub: subject,
                name: '测试用户',
                platform_link: {
                  linked: true,
                  local_account_id: '128'
                }
              }
            })
          )
        };

        const service =
          new IdentityOIDCService({
            identityConfig:
              buildIdentityConfig(),
            httpClient: fakeHTTP
          });

        const result =
          await service.getUserInfo(
            'x'.repeat(43),
            subject
          );

        expect(
          result.platform_link
            .local_account_id
        ).toBe('128');
      }
    );

    test(
      'Backchannel JSON不携带Client Secret或platform_client_id',
      async () => {
        let captured = null;

        const fakeHTTP = {
          post: jest.fn(
            async (
              url,
              body,
              options
            ) => {
              captured = {
                url,
                body,
                options
              };

              return {
                data: {
                  outcome: 'success'
                }
              };
            }
          )
        };

        const service =
          new IdentityOIDCService({
            identityConfig:
              buildIdentityConfig(),
            httpClient: fakeHTTP
          });

        await service
          .mutatePlatformLink({
            operation: 'link',

            globalPersonId:
              '55a8827b-06af-47de-a3b0-743fd889711e',

            localAccountId: '128',

            traceId:
              'ai-id:test:128'
          });

        expect(
          captured.body
            .local_account_id
        ).toBe('128');

        expect(
          captured.body.client_id
        ).toBeUndefined();

        expect(
          captured.body
            .client_secret
        ).toBeUndefined();

        expect(
          captured.body
            .platform_client_id
        ).toBeUndefined();

        expect(
          captured.options.auth.username
        ).toBe('ai-platform-client');

        expect(
          captured.options.auth.password
        ).toHaveLength(64);
      }
    );
  }
);
