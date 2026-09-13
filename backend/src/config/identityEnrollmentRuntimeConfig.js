'use strict';

const path = require('node:path');
const { loadIdentityRuntimeConfig, validateIdentityRuntimeConfig } = require('./identityRuntimeConfig');
const C = require('../services/auth/IdentityEnrollmentContract');
const S = require('../services/auth/IdentityEnrollmentState');

/**
 * 将Enrollment私有凭据接入已有运行配置，启动时读取一次，不访问Identity或业务数据库。
 * 旧部署继续使用环境变量；显式选择文件后，任何错误都禁止回退到环境变量Secret。
 * 登记回执中的disabled是登记时事实，不是实时启用状态；Verify/Enable仍由独立流程执行。
 */
function loadIdentityDeploymentConfig(env = process.env) {
  const base = loadIdentityRuntimeConfig(env);
  const instanceKey = env.IDENTITY_DEPLOYMENT_INSTANCE_KEY || '';
  const current = { ...base, deploymentInstanceKey: instanceKey, credentialError: false };

  // 关闭Identity时不读取凭据文件，避免缺少挂载影响既有本地登录和平台启动。
  if (!base.enabled) return Object.freeze({ ...current, clientSecret: '' });

  try {
    if (instanceKey !== '') {
      C.requireValue(typeof instanceKey === 'string' && instanceKey.length >= 2 && instanceKey.length <= 128 &&
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(instanceKey));
    }
    const file = env.IDENTITY_CREDENTIALS_FILE;
    if (file === undefined || file === '') return Object.freeze(current);

    // 文件模式必须显式声明四个信任字段，不能以旧客户端、默认域名或文件内容反推部署身份。
    for (const name of ['IDENTITY_ISSUER', 'IDENTITY_PUBLIC_ORIGIN', 'IDENTITY_CLIENT_ID',
      'IDENTITY_DEPLOYMENT_INSTANCE_KEY']) {
      C.requireValue(typeof env[name] === 'string' && env[name].length > 0);
    }
    C.requireValue(env.IDENTITY_CLIENT_SECRET === undefined || env.IDENTITY_CLIENT_SECRET === '');
    C.requireValue(typeof file === 'string' && path.isAbsolute(file) && path.normalize(file) === file &&
      path.basename(file) === 'credentials.json');

    const root = path.dirname(file);
    const request = S.load(root);
    const saved = S.readPrivate(file);
    C.exactKeys(saved, ['schema_version', 'request_sha256', 'kind', 'response']);
    C.requireValue(saved.schema_version === 1 && saved.request_sha256 === S.digest(request));
    C.requireValue(saved.kind === 'first' || saved.kind === 'recovery');
    C.receipt(saved.response, request, saved.kind);

    C.requireValue(request.identity_issuer === base.issuer && request.binding.public_origin === base.publicOrigin &&
      request.binding.identity_client_id === base.clientId && request.binding.deployment_instance_key === instanceKey);

    // 最后使用既有完整校验器校验回调、Backchannel、Scope及数值范围，再交给OIDC服务。
    return validateIdentityRuntimeConfig({ ...current, clientSecret: saved.response.client_secret });
  } catch {
    // 不把路径、文件正文、系统异常或凭据带入配置错误。清空Secret确保Identity请求校验失败。
    // 不抛出启动异常，平台的本地登录、业务数据库和其他功能继续按原配置工作。
    return Object.freeze({ ...current, clientSecret: '', credentialError: true });
  }
}

module.exports = { loadIdentityDeploymentConfig };
