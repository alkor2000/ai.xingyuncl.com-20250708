/**
 * 给样板的段落贴角色：左侧序号/内容/格式，右侧角色下拉；同一角色第一个块是"原型"（生成时克隆它的格式）
 */
import React, { useMemo } from 'react'
import { Table, Select, Tag, Typography, Space, Alert } from 'antd'
import { useTranslation } from 'react-i18next'
import { ROLE_KEYS, ROLE_COLORS, PROTO_ROLES } from './roleMeta'

const { Text } = Typography

const formatLabel = (f, t) => {
  if (!f) return ''
  const parts = []
  if (f.font) parts.push(f.font)
  if (f.size) parts.push(f.sizeName ? `${f.sizeName}(${f.size}pt)` : `${f.size}pt`)
  if (f.bold) parts.push(t('chat.docTemplate.fmt.bold'))
  if (f.align === 'center') parts.push(t('chat.docTemplate.fmt.center'))
  else if (f.align === 'right' || f.align === 'end') parts.push(t('chat.docTemplate.fmt.right'))
  if (f.firstLine) parts.push(t('chat.docTemplate.fmt.firstLine', { n: f.firstLine }))
  if (f.color && f.color.toUpperCase() === 'FF0000') parts.push(t('chat.docTemplate.fmt.red'))
  return parts.join(' · ')
}

const RoleLabeler = ({ blocks, roles, onChange, readOnly = false }) => {
  const { t } = useTranslation()
  const roleOf = useMemo(() => new Map((roles || []).map((r) => [r.index, r.role])), [roles])
  const firstOfRole = useMemo(() => {
    const seen = new Map()
    ;(blocks || []).forEach((b) => { const r = roleOf.get(b.index); if (PROTO_ROLES.includes(r) && !seen.has(r)) seen.set(r, b.index) })
    return seen
  }, [blocks, roleOf])
  const setRole = (index, role) => {
    const next = (blocks || []).map((b) => ({ index: b.index, role: b.index === index ? role : (roleOf.get(b.index) || 'fixed') }))
    onChange(next)
  }
  const options = ROLE_KEYS.map((k) => ({ value: k, label: <span><i className="doc-role-dot" style={{ background: ROLE_COLORS[k] }} />{t(`chat.docTemplate.role.${k}`)}</span> }))
  const columns = [
    { title: '#', dataIndex: 'index', width: 44, render: (v) => v + 1 },
    {
      title: t('chat.docTemplate.labeler.content'),
      dataIndex: 'text',
      render: (v, b) => (b.kind === 'tbl'
        ? <Text type="secondary">{t('chat.docTemplate.labeler.table', { rows: b.rows })}{v ? `：${v}` : ''}</Text>
        : (b.empty ? <Text type="secondary" italic>{t('chat.docTemplate.labeler.emptyLine')}</Text> : <span className="doc-block-text">{v}</span>))
    },
    { title: t('chat.docTemplate.labeler.format'), width: 220, render: (_, b) => <Text type="secondary" className="doc-block-format">{b.kind === 'p' ? formatLabel(b.format, t) : ''}</Text> },
    {
      title: t('chat.docTemplate.labeler.role'),
      width: 190,
      render: (_, b) => {
        const role = roleOf.get(b.index) || 'fixed'
        return (
          <Space size={4}>
            <Select size="small" value={role} options={options} disabled={readOnly} onChange={(v) => setRole(b.index, v)} style={{ width: 130 }} popupMatchSelectWidth={false} />
            {firstOfRole.get(role) === b.index && <Tag color="green" style={{ margin: 0 }}>{t('chat.docTemplate.labeler.proto')}</Tag>}
          </Space>
        )
      }
    }
  ]
  const hasBody = Array.from(roleOf.values()).includes('body')
  return (
    <div className="doc-role-labeler">
      <Alert type="info" showIcon style={{ marginBottom: 10 }} message={t('chat.docTemplate.labeler.hint')} />
      {!hasBody && <Alert type="warning" showIcon style={{ marginBottom: 10 }} message={t('chat.docTemplate.labeler.needBody')} />}
      <Table
        size="small"
        rowKey="index"
        pagination={false}
        dataSource={blocks || []}
        columns={columns}
        rowClassName={(b) => `doc-role-row doc-role-${roleOf.get(b.index) || 'fixed'}`}
        onRow={(b) => ({ style: { borderLeft: `4px solid ${ROLE_COLORS[roleOf.get(b.index) || 'fixed']}` } })}
        scroll={{ y: 420 }}
      />
    </div>
  )
}

export default RoleLabeler
