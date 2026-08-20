/**
 * 404 页面未找到
 *
 * 作为路由兜底页，用户访问不存在的路径时展示。
 *
 * ===== v1.1 国际化改造要点 =====
 *
 * 1. 本组件此前未接入 i18n，subTitle 与按钮文字为硬编码中文。
 *
 * 2. 文案键选用说明（为何不复用看起来相同的既有键）：
 *    - 用 error.pageNotFound 而非 error.notFound：
 *      后者是"资源不存在"，语义面向 API 请求失败；
 *      页面级 404 面向用户导航，两者措辞与场景不同，不应混用。
 *    - 用 error.backHome 而非 auth.login.backHome：
 *      两者当前中文值相同，但分属不同命名空间。
 *      错误页引用 auth 命名空间会产生跨模块耦合，
 *      将来调整登录页文案会连带影响错误页。
 *
 * 3. Result 的 title="404" 是 HTTP 状态码，属技术标识，不翻译。
 *
 * 4. 跳转目标使用 /dashboard（工作台），与侧边栏首页保持一致。
 */

import React from 'react'
import { Result, Button } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

/* 点击返回按钮的落地路径，与登录后的默认首页保持一致 */
const HOME_PATH = '/dashboard'

const NotFound = () => {
  const navigate = useNavigate()
  const { t } = useTranslation()

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <Result
        status="404"
        /* HTTP 状态码属技术标识，不参与翻译 */
        title="404"
        subTitle={t('error.pageNotFound')}
        extra={
          <Button type="primary" onClick={() => navigate(HOME_PATH)}>
            {t('error.backHome')}
          </Button>
        }
      />
    </div>
  )
}

export default NotFound
