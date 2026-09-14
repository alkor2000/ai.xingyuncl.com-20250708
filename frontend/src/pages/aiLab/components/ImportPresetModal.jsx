/**
 * 导入预置数据包：列出与数据集类型匹配的包，选每类数量与换条件集，服务器把样本复制进本数据集
 * 导入的样本 source='preset'，与自采样本走同一套留出/训练/测试流程。
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Modal, Radio, Checkbox, Select, Space, Tag, Typography, Alert, Spin, message } from 'antd'
import { useTranslation } from 'react-i18next'
import useAiLabStore from '../../../stores/aiLabStore'

const { Text, Paragraph } = Typography
const PER_CLASS_OPTIONS = [3, 10, 30, 'all']

const ImportPresetModal = ({ open, onClose, dataset, task, kind, onImported }) => {
  const { t, i18n } = useTranslation()
  const { presets, fetchPresets, importPreset, recordEvent } = useAiLabStore()
  const [loading, setLoading] = useState(false)
  const [packKey, setPackKey] = useState(null)
  const [perClass, setPerClass] = useState('all')
  const [shiftSets, setShiftSets] = useState([])
  const [classKeys, setClassKeys] = useState([])
  const [importing, setImporting] = useState(false)

  const targetKind = kind || dataset?.kind || 'image'
  const datasetEmpty = !dataset || (dataset.sample_count || 0) === 0
  const candidates = useMemo(() => {
    const list = (presets || []).filter((p) => p.kind === targetKind || (datasetEmpty && !kind))
    const preferred = task?.presets || []
    return [...list].sort((a, b) => {
      const ia = preferred.indexOf(a.key); const ib = preferred.indexOf(b.key)
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
    })
  }, [presets, targetKind, datasetEmpty, kind, task])
  const pack = candidates.find((p) => p.key === packKey) || null

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetchPresets().catch(() => message.error(t('aiLab.preset.loadFailed'))).finally(() => setLoading(false))
    // 只在打开时拉取，不依赖 t
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  useEffect(() => {
    if (!packKey && candidates.length) setPackKey(candidates[0].key)
  }, [candidates, packKey])
  useEffect(() => {
    if (!pack) return
    setShiftSets(Object.keys(pack.counts?.shift || {}))
    /* 模板可要求默认只选前 n 类（如低年级两类入门），否则全选 */
    const keys = (pack.classes || []).map((c) => c.key)
    const n = Number(task?.config?.preset_class_count)
    setClassKeys(Number.isInteger(n) && n >= 2 && n < keys.length ? keys.slice(0, n) : keys)
    // 只在换包时重置，不依赖 task
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack])
  const allClasses = (pack?.classes || []).map((c) => c.key)
  const partial = classKeys.length > 0 && classKeys.length < allClasses.length

  const packTitle = (p) => (i18n.exists(`aiLab.presetPack.${p.key}.title`) ? t(`aiLab.presetPack.${p.key}.title`) : p.title)
  const packDesc = (p) => (i18n.exists(`aiLab.presetPack.${p.key}.desc`) ? t(`aiLab.presetPack.${p.key}.desc`) : p.description)

  const handleOk = async () => {
    if (!pack || !dataset) return
    setImporting(true)
    try {
      const payload = { pack_key: pack.key, shift_sets: shiftSets }
      if ((targetKind === 'image' || targetKind === 'audio') && perClass !== 'all') payload.per_class = perClass
      if (partial) payload.class_keys = classKeys
      const result = await importPreset(dataset.id, payload)
      const shiftTotal = Object.values(result?.imported?.shift || {}).reduce((a, b) => a + b, 0)
      recordEvent('preset.import', { dataset_id: dataset.id, pack_key: pack.key, per_class: perClass === 'all' ? null : perClass, shift_sets: shiftSets, class_keys: partial ? classKeys : null, imported: result?.imported || null })
      message.success(t('aiLab.preset.imported', { train: result?.imported?.train ?? 0, shift: shiftTotal }))
      if (onImported) onImported(result)
      onClose()
    } catch (err) {
      console.error('preset import failed:', err)
      message.error(t('aiLab.preset.importFailed'))
    } finally {
      setImporting(false)
    }
  }

  const trainTotal = (p) => Object.values(p.counts?.train || {}).reduce((a, b) => a + b, 0)

  return (
    <Modal
      title={t('aiLab.preset.title')}
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      okText={t('aiLab.preset.import')}
      cancelText={t('common.cancel')}
      confirmLoading={importing}
      okButtonProps={{ disabled: !pack || classKeys.length < 2 }}
      width={640}
    >
      {loading ? <div className="ailab-loading"><Spin /></div> : (
        <>
          {!candidates.length && <Alert type="info" showIcon message={t('aiLab.preset.empty')} />}
          <Radio.Group value={packKey} onChange={(e) => setPackKey(e.target.value)} className="ailab-preset-list">
            {candidates.map((p) => (
              <Radio key={p.key} value={p.key} className="ailab-preset-option">
                <div className="ailab-preset-title">
                  {packTitle(p)}
                  <Tag style={{ marginLeft: 8 }}>{t(`aiLab.kind.${p.kind}`)}</Tag>
                  <Tag>{t('aiLab.preset.trainCount', { count: trainTotal(p) })}</Tag>
                  {Object.keys(p.counts?.shift || {}).length > 0 && <Tag color="orange">{t('aiLab.preset.shiftCount', { count: Object.keys(p.counts.shift).length })}</Tag>}
                </div>
                <div className="ailab-preset-desc">{packDesc(p)}</div>
                <div className="ailab-muted">{t('aiLab.preset.classesLabel', { classes: (p.classes || []).map((c) => c.label).join('、') })}</div>
              </Radio>
            ))}
          </Radio.Group>
          {pack && (
            <div className="ailab-preset-options">
              {allClasses.length > 2 && (
                <div className="ailab-field">
                  <label>{t('aiLab.preset.classes')}</label>
                  <Checkbox.Group value={classKeys} onChange={setClassKeys}
                    options={(pack.classes || []).map((c) => ({ value: c.key, label: `${c.label} (${pack.counts?.train?.[c.key] || 0})` }))} />
                  {classKeys.length < 2 && <div><Text type="warning">{t('aiLab.preset.classesMin')}</Text></div>}
                </div>
              )}
              {(targetKind === 'image' || targetKind === 'audio') && (
                <div className="ailab-field">
                  <label>{t('aiLab.preset.perClass')}</label>
                  <Radio.Group value={perClass} onChange={(e) => setPerClass(e.target.value)} optionType="button" size="small"
                    options={PER_CLASS_OPTIONS.map((v) => ({ value: v, label: v === 'all' ? t('aiLab.preset.perClassAll') : String(v) }))} />
                </div>
              )}
              {Object.keys(pack.counts?.shift || {}).length > 0 && (
                <div className="ailab-field">
                  <label>{t('aiLab.preset.shiftSets')}</label>
                  <Checkbox.Group value={shiftSets} onChange={setShiftSets}
                    options={Object.entries(pack.counts.shift).map(([name, byClass]) => ({ value: name, label: `${name} (${Object.values(byClass).reduce((a, b) => a + b, 0)})` }))} />
                </div>
              )}
              <Paragraph className="ailab-muted" style={{ marginBottom: 0 }}>
                {t('aiLab.preset.license')}: {pack.license}{pack.attribution ? ` · ${pack.attribution}` : ''}
                {pack.source && pack.source.startsWith('http') && <> · <a href={pack.source} target="_blank" rel="noreferrer">{t('aiLab.preset.source')}</a></>}
              </Paragraph>
              {dataset?.locked_at && <Text type="warning">{t('aiLab.preset.relockHint')}</Text>}
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

export default ImportPresetModal
