/**
 * Identity浏览器公开配置接口。
 *
 * 只从后端启动配置生成字段白名单，供前端校验授权跳转目标。
 * 不采用Host、转发头、Query或请求体提供的来源与客户端参数。
 * 本接口不执行Enrollment、不创建Flow、不访问数据库或Identity服务。
 */
const config = require('../config');
const { validateIdentityRuntimeConfig } = require('../config/identityRuntimeConfig');

/**
 * 返回当前部署的公开认证合同。
 * 未启用时仅返回关闭状态；配置错误时拒绝提供可用于跳转的部分合同。
 * 禁止展开整个identity对象，否则未来新增的凭据字段可能被意外公开。
 */
function getPublicConfig(_req, res) {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  res.set('X-Content-Type-Options', 'nosniff');

  if (config.identity?.enabled === false) {
    return res.status(200).json({ success: true, data: { enabled: false } });
  }

  let identity;
  try {
    identity = validateIdentityRuntimeConfig(config.identity);
  } catch {
    // 不回显原始异常、配置值或Secret；浏览器收到错误后不得继续授权跳转。
    return res.status(503).json({
      success: false,
      code: 'IDENTITY_CONFIG_INVALID',
      message: '统一身份配置暂不可用，请使用原有登录方式。',
      data: null
    });
  }

  return res.status(200).json({
    success: true,
    data: {
      enabled: true,
      issuer: identity.issuer,
      publicOrigin: identity.publicOrigin,
      clientId: identity.clientId,
      authorizationEndpoint: identity.issuer + '/oauth/authorize',
      loginRedirectUri: identity.loginRedirectUri,
      bindRedirectUri: identity.bindRedirectUri,
      scopes: [...identity.scopes],
      responseType: 'code',
      responseMode: 'query',
      codeChallengeMethod: 'S256'
    }
  });
}

module.exports = { getPublicConfig };
