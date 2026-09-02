/**
 * PKU AI Lab统一身份关联管理。
 *
 * 产品原则：
 * - Identity Center是关联事实唯一权威；
 * - AI平台不缓存global_person_id；
 * - AI平台不保存一个可能陈旧的“已关联/未关联”副本；
 * - 每次连接或解除都重新进入Identity Center强认证；
 * - 操作前明确展示并确认当前平台账号，适配共享设备场景。
 */

import React, {
  useEffect,
  useState
} from 'react'

import {
  Alert,
  Button,
  Card,
  Modal,
  Space,
  Tag,
  Typography,
  message
} from 'antd'

import {
  DisconnectOutlined,
  LinkOutlined,
  SafetyCertificateOutlined
} from '@ant-design/icons'

import {
  useLocation,
  useNavigate,
  useSearchParams
} from 'react-router-dom'

import {
  useTranslation
} from 'react-i18next'

import useAuthStore from '../../stores/authStore'
import apiClient from '../../utils/api'

import {
  validateIdentityAuthorizationURL
} from '../../utils/identityAuthorization'

import {
  getPortalCapabilityLandingPath
} from '../../utils/portalCapabilityEntry'

import {
  getPortalConnectCapabilityFromProfileSearch
} from '../../utils/portalIdentityConnect'

const {
  Paragraph,
  Text,
  Title
} = Typography

const IdentityAccountLinkPanel = () => {
  const {
    t
  } = useTranslation()

  const {
    user
  } = useAuthStore()

  const [
    searchParams
  ] = useSearchParams()

  const location =
    useLocation()

  const navigate =
    useNavigate()

  const [
    operation,
    setOperation
  ] = useState(null)

  // Portal只把stable capability带到这里。
  // 真实业务页面只在AI平台自己的Capability Adapter中解析。
  const portalCapability =
    getPortalConnectCapabilityFromProfileSearch(
      location.search
    )

  const portalCapabilityLanding =
    getPortalCapabilityLandingPath(
      portalCapability
    )

  /**
   * 展示OAuth callback产生的稳定业务结果，
   * 随即清理Query，防止刷新页面重复提示。
   */
  useEffect(() => {
    const linked =
      searchParams.get(
        'identity_link'
      )

    const unlinked =
      searchParams.get(
        'identity_unlink'
      )

    const errorCode =
      searchParams.get(
        'identity_error'
      )

    if (
      linked === 'success'
    ) {
      message.success(
        t(
          'profile.identity.linkSuccess',
          {
            defaultValue:
              '当前平台账号已完成统一身份关联。'
          }
        )
      )
    } else if (
      unlinked === 'success'
    ) {
      message.success(
        t(
          'profile.identity.unlinkSuccess',
          {
            defaultValue:
              '当前平台账号已解除统一身份关联。'
          }
        )
      )
    } else if (
      errorCode
    ) {
      const messages = {
        authorization_failed:
          '你没有完成统一身份验证，本次操作未产生变更。',

        link_conflict:
          '统一身份或当前平台账号已经存在其他关联，无法完成本次操作。',

        account_unavailable:
          '当前平台账号不可用，请重新登录或联系管理员。',

        purpose_mismatch:
          '本次统一身份操作已经失效，请重新发起。',

        identity_state_invalid:
          '统一身份返回的关联状态无法验证，请重新发起。',

        callback_failed:
          '统一身份操作未完成，请稍后重试。'
      }

      message.error(
        t(
          'profile.identity.operationFailed',
          {
            defaultValue:
              messages[errorCode] ||
              '统一身份操作未完成，请重新尝试。'
          }
        )
      )
    } else {
      return
    }

    navigate(
      '/profile',
      {
        replace: true
      }
    )
  }, [
    searchParams,
    navigate,
    t
  ])

  const currentAccountLabel =
    user?.username ||
    user?.email ||
    `ID ${user?.id || ''}`

  const openIdentityOperation =
    async (
      requestedOperation
    ) => {
      if (
        !user?.id ||
        operation
      ) {
        return
      }

      const isLink =
        requestedOperation ===
          'link'

      Modal.confirm({
        title:
          isLink
            ? t(
                'profile.identity.linkConfirmTitle',
                {
                  defaultValue:
                    '确认连接当前平台账号'
                }
              )
            : t(
                'profile.identity.unlinkConfirmTitle',
                {
                  defaultValue:
                    '确认解除当前平台账号关联'
                }
              ),

        icon:
          <SafetyCertificateOutlined />,

        content: (
          <div>
            <Paragraph>
              {isLink
                ? t(
                    'profile.identity.linkConfirmText',
                    {
                      defaultValue:
                        `确认绑定当前平台账号 ${currentAccountLabel}（ID ${user.id}）？继续后将前往 PKU AI Lab 统一身份中心完成身份验证。`
                    }
                  )
                : t(
                    'profile.identity.unlinkConfirmText',
                    {
                      defaultValue:
                        `确认解除当前平台账号 ${currentAccountLabel}（ID ${user.id}）与统一身份的关联？平台账号本身不会被删除。`
                    }
                  )}
            </Paragraph>

            <Alert
              type="info"
              showIcon
              message={t(
                'profile.identity.strongAuthNotice',
                {
                  defaultValue:
                    '连接和解除都会重新验证统一身份，不会静默使用其他人的登录状态。'
                }
              )}
            />
          </div>
        ),

        okText:
          t(
            'button.confirm'
          ),

        cancelText:
          t(
            'button.cancel'
          ),

        okButtonProps: {
          danger:
            !isLink
        },

        onOk:
          async () => {
            setOperation(
              requestedOperation
            )

            try {
              const endpoint =
                isLink
                  ? '/auth/identity/connect/start'
                  : '/auth/identity/unlink/start'

              const response =
                await apiClient.post(
                  endpoint,
                  {
                    confirm_current_account:
                      true,
                    return_to:
                      isLink &&
                      portalCapabilityLanding
                        ? portalCapabilityLanding
                        : '/profile'
                  }
                )

              const authorizationURL =
                response?.data?.data
                  ?.authorizationUrl

              const safeURL =
                validateIdentityAuthorizationURL(
                  authorizationURL
                )

              window.location.assign(
                safeURL
              )
            } catch (error) {
              console.error(
                'Identity account operation start failed:',
                error
              )

              setOperation(
                null
              )

              message.error(
                error.response?.data
                  ?.message ||
                t(
                  'profile.identity.startFailed',
                  {
                    defaultValue:
                      '统一身份服务暂时不可用，请稍后重试。'
                  }
                )
              )
            }
          }
      })
    }

  return (
    <Card
      bordered={false}
      style={{
        background:
          '#fafcff'
      }}
    >
      <Space
        direction="vertical"
        size={16}
        style={{
          width: '100%'
        }}
      >
        <div>
          <Space>
            <SafetyCertificateOutlined
              style={{
                color:
                  '#1677ff'
              }}
            />

            <Title
              level={4}
              style={{
                margin: 0
              }}
            >
              {t(
                'profile.identity.title',
                {
                  defaultValue:
                    '统一身份关联管理'
                }
              )}
            </Title>

            <Tag color="blue">
              {t(
                'profile.identity.realtimeVerify',
                {
                  defaultValue:
                    '操作时实时核验'
                }
              )}
            </Tag>
          </Space>
        </div>

        <Paragraph
          type="secondary"
          style={{
            marginBottom: 0
          }}
        >
          {t(
            'profile.identity.description',
            {
              defaultValue:
                '统一身份关联事实由 PKU AI Lab 统一身份中心保存。本平台不缓存可能过期的关联状态；每次连接或解除时都会重新核验。'
            }
          )}
        </Paragraph>

        <Alert
          type="info"
          showIcon
          message={t(
            'profile.identity.currentAccount',
            {
              defaultValue:
                `当前平台账号：${currentAccountLabel}（ID ${user?.id || '-'}）`
            }
          )}
          description={t(
            'profile.identity.sharedDeviceNotice',
            {
              defaultValue:
                '如果正在使用公共或共享设备，请确认这里显示的确实是你要操作的当前平台账号。'
            }
          )}
        />

        <Space
          wrap
        >
          <Button
            type="primary"
            icon={
              <LinkOutlined />
            }
            loading={
              operation ===
                'link'
            }
            disabled={
              operation !==
                null
            }
            onClick={() =>
              openIdentityOperation(
                'link'
              )
            }
          >
            {t(
              'profile.identity.linkButton',
              {
                defaultValue:
                  '连接统一身份'
              }
            )}
          </Button>

          <Button
            danger
            icon={
              <DisconnectOutlined />
            }
            loading={
              operation ===
                'unlink'
            }
            disabled={
              operation !==
                null
            }
            onClick={() =>
              openIdentityOperation(
                'unlink'
              )
            }
          >
            {t(
              'profile.identity.unlinkButton',
              {
                defaultValue:
                  '解除统一身份关联'
              }
            )}
          </Button>
        </Space>

        <Text
          type="secondary"
          style={{
            fontSize:
              12
          }}
        >
          {t(
            'profile.identity.noLocalStatus',
            {
              defaultValue:
                '说明：这里不显示本地缓存的“已关联/未关联”，避免过期状态误导。实际关联事实以统一身份中心为准。'
            }
          )}
        </Text>
      </Space>
    </Card>
  )
}

export default IdentityAccountLinkPanel
