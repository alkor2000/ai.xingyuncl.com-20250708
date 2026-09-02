/**
 * D-02 Identity OIDC安全基础层正式Jest入口。
 *
 * 真实测试实现保留在services/auth旁，方便协议代码与定向测试一起维护；
 * 本文件只负责把该测试纳入项目既有src/__tests__发现规则。
 */

require('../../../../services/auth/IdentityIntegrationServices.test');
