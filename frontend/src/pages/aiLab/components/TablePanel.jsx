/**
 * 表格数据集面板：列定义、各类别数量、训练集行表、各类取值范围、散点图，以及手工加一行
 * 留出集行不显示（与图像数据集一致），测试时才揭晓。
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Table, Tabs, Tag, Select, Space, Button, Input, InputNumber, Tooltip, Empty, message } from 'antd'
import { LockOutlined, PlusOutlined, DatabaseOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import ScatterPlot from './ScatterPlot'
import { summarizeColumns, columnValues } from '../engine/tabular/stats'

export const toRows = (samples, split = 'train') => (samples || []).filter((s) => s.split === split).map((s) => ({ id: s.id, label: s.class_key, payload: s.payload || {} }))

const TablePanel = ({ dataset, samples, canEdit, labelOf, onImport, onAddRow }) => {
  const { t } = useTranslation()
  const allColumns = dataset?.columns || []
  const columns = allColumns.filter((c) => c.type !== 'text')
  const textColumns = allColumns.filter((c) => c.type === 'text')
  const classes = dataset?.classes || []
  const counts = dataset?.counts || { train: {}, holdout: {}, shift: {} }
  const rows = useMemo(() => toRows(samples, 'train'), [samples])
  const numeric = columns.filter((c) => c.type === 'number')
  const [xKey, setXKey] = useState(numeric[0]?.key)
  const [yKey, setYKey] = useState(numeric[1]?.key || numeric[0]?.key)
  const [draft, setDraft] = useState({})
  const [draftClass, setDraftClass] = useState(classes[0]?.key)
  const [adding, setAdding] = useState(false)
  const stats = useMemo(() => summarizeColumns(rows, columns), [rows, columns])
  /* 列定义可能在导入预置包后才到达：坐标轴与默认类别随之补齐 */
  useEffect(() => {
    if (!numeric.find((c) => c.key === xKey)) setXKey(numeric[0]?.key)
    if (!numeric.find((c) => c.key === yKey)) setYKey(numeric[1]?.key || numeric[0]?.key)
    if (!classes.find((c) => c.key === draftClass)) setDraftClass(classes[0]?.key)
  }, [columns, classes]) // eslint-disable-line react-hooks/exhaustive-deps
  const columnLabel = (key) => columns.find((c) => c.key === key)?.label || key
  const unit = (key) => columns.find((c) => c.key === key)?.unit || ''
  const shiftTotal = (key) => Object.values(counts.shift || {}).reduce((a, set) => a + (set[key] || 0), 0)
  const holdoutTotal = Object.values(counts.holdout || {}).reduce((a, b) => a + b, 0)

  const submitRow = async () => {
    const payload = {}
    for (const c of allColumns) {
      const v = draft[c.key]
      if (v === undefined || v === null || v === '') { message.warning(t('aiLab.table.fillAll')); return }
      payload[c.key] = c.type === 'number' ? Number(v) : String(v)
    }
    if (!draftClass) return
    setAdding(true)
    try {
      await onAddRow({ class_key: draftClass, payload })
      setDraft({})
      message.success(t('aiLab.table.addRowDone'))
    } catch (err) {
      message.error(t('aiLab.table.addRowFailed'))
    } finally {
      setAdding(false)
    }
  }

  const tableColumns = [
    ...textColumns.map((c) => ({ title: c.label, dataIndex: ['payload', c.key], width: 110, render: (v) => <b>{v ?? ''}</b> })),
    { title: t('aiLab.table.classCol'), dataIndex: 'label', width: 120, render: (v) => <Tag color="blue">{labelOf(v)}</Tag>, filters: classes.map((c) => ({ text: c.label, value: c.key })), onFilter: (v, r) => r.label === v },
    ...columns.map((c) => ({
      title: c.unit ? `${c.label} (${c.unit})` : c.label,
      dataIndex: ['payload', c.key],
      sorter: c.type === 'number' ? (a, b) => Number(a.payload[c.key]) - Number(b.payload[c.key]) : undefined,
      render: (v) => (v === undefined || v === null ? <span className="ailab-muted">—</span> : String(v))
    }))
  ]

  const statCell = (col, key) => {
    const s = stats[col.key]?.[key]
    if (!s) return <span className="ailab-muted">—</span>
    if (col.type === 'number') return <span className="ailab-stat-range">{s.min} <small>–</small> <b>{Number(s.median.toFixed(2))}</b> <small>–</small> {s.max}</span>
    return Object.entries(s).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v, n]) => `${v}×${n}`).join('，')
  }

  return (
    <div className="ailab-table-panel">
      <Space wrap style={{ marginBottom: 10 }}>
        {columns.map((c) => <Tag key={c.key} icon={<DatabaseOutlined />}>{c.label}{c.unit ? ` (${c.unit})` : ''} · {t(`aiLab.table.type.${c.type}`)}</Tag>)}
        {!columns.length && <span className="ailab-muted">{t('aiLab.table.noColumns')}</span>}
      </Space>
      <div className="ailab-class-head" style={{ marginBottom: 12 }}>
        {classes.map((cls) => (
          <span key={cls.key} className="ailab-class-chip">
            <b>{cls.label}</b>
            <Tag>{t('aiLab.split.train')} {counts.train?.[cls.key] || 0}</Tag>
            <Tooltip title={t('aiLab.dataset.holdoutHidden')}><Tag icon={<LockOutlined />}>{counts.holdout?.[cls.key] || 0}</Tag></Tooltip>
            <Tag color="orange">{t('aiLab.split.shift')} {shiftTotal(cls.key)}</Tag>
          </span>
        ))}
        {canEdit && onImport && <Button size="small" icon={<PlusOutlined />} onClick={onImport}>{t('aiLab.preset.buttonOpen')}</Button>}
      </div>
      {!rows.length && <Empty description={t('aiLab.table.noRows')} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      {rows.length > 0 && (
        <Tabs
          size="small"
          items={[
            {
              key: 'rows',
              label: t('aiLab.table.rowsTab'),
              children: (
                <>
                  <div className="ailab-muted" style={{ marginBottom: 6 }}>{t('aiLab.table.rowsShown', { count: rows.length, holdout: holdoutTotal })}</div>
                  <Table size="small" rowKey="id" dataSource={rows} columns={tableColumns} pagination={{ pageSize: 10, size: 'small' }} scroll={{ x: true }} />
                </>
              )
            },
            {
              key: 'stats',
              label: t('aiLab.table.statsTab'),
              children: (
                <div className="ailab-cm-wrap">
                  <table className="ailab-cm ailab-stats">
                    <thead><tr><th>{t('aiLab.table.columnCol')}</th>{classes.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
                    <tbody>
                      {columns.map((c) => (
                        <tr key={c.key}><th>{c.label}{c.unit ? ` (${c.unit})` : ''}</th>{classes.map((cls) => <td key={cls.key}>{statCell(c, cls.key)}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="ailab-muted" style={{ marginTop: 6 }}>{t('aiLab.table.statsHint')}</div>
                </div>
              )
            },
            numeric.length >= 2 && {
              key: 'scatter',
              label: t('aiLab.table.scatterTab'),
              children: (
                <div>
                  <Space wrap style={{ marginBottom: 8 }}>
                    <span>{t('aiLab.table.xAxis')}</span>
                    <Select size="small" value={xKey} onChange={setXKey} style={{ width: 150 }} options={numeric.map((c) => ({ value: c.key, label: c.label }))} />
                    <span>{t('aiLab.table.yAxis')}</span>
                    <Select size="small" value={yKey} onChange={setYKey} style={{ width: 150 }} options={numeric.map((c) => ({ value: c.key, label: c.label }))} />
                  </Space>
                  <ScatterPlot rows={rows} xKey={xKey} yKey={yKey} classKeys={classes.map((c) => c.key)} labelOf={labelOf} columnLabel={(k) => `${columnLabel(k)}${unit(k) ? ` (${unit(k)})` : ''}`} />
                </div>
              )
            }
          ].filter(Boolean)}
        />
      )}
      {canEdit && allColumns.length > 0 && onAddRow && (
        <div className="ailab-add-row">
          <div className="ailab-muted" style={{ marginBottom: 6 }}>{t('aiLab.table.addRowHint')}</div>
          <Space wrap>
            {textColumns.map((c) => <Input key={c.key} size="small" placeholder={c.label} value={draft[c.key] || ''} maxLength={60} onChange={(e) => setDraft((d) => ({ ...d, [c.key]: e.target.value }))} style={{ width: 120 }} />)}
            {columns.map((c) => (c.type === 'number'
              ? <InputNumber key={c.key} size="small" placeholder={c.label} value={draft[c.key]} onChange={(v) => setDraft((d) => ({ ...d, [c.key]: v }))} style={{ width: 120 }} />
              : (
                <Select key={c.key} size="small" placeholder={c.label} value={draft[c.key]} onChange={(v) => setDraft((d) => ({ ...d, [c.key]: v }))} style={{ width: 120 }} allowClear
                  showSearch options={columnValues(rows, c.key).map((v) => ({ value: v, label: v }))}
                  dropdownRender={(menu) => <>{menu}<Input size="small" placeholder={t('aiLab.table.newValue')} onPressEnter={(e) => { setDraft((d) => ({ ...d, [c.key]: e.target.value })); e.stopPropagation() }} style={{ margin: 4 }} /></>} />
              )))}
            <Select size="small" value={draftClass} onChange={setDraftClass} style={{ width: 130 }} options={classes.map((c) => ({ value: c.key, label: c.label }))} placeholder={t('aiLab.table.classCol')} />
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={submitRow} loading={adding}>{t('aiLab.table.addRow')}</Button>
          </Space>
        </div>
      )}
    </div>
  )
}

export default TablePanel
