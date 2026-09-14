/**
 * 核实工作台（P7 "AI 给出的校园资讯可信吗"）：
 * 材料（原始通知 + AI 稿子）→ 拆成说法 → 逐条判定并写依据 → 改写稿子 → 反思
 * 所有内容存在 project.context.verify，关键动作记 claim.write / claim.verify / claim.revise / reflection.write。
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Radio, Input, Button, Space, Tag, Alert, Typography, Table, Select, Collapse, message } from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAiLabStore from '../../../stores/aiLabStore'
import { getVerifyMaterials } from '../content/verifyMaterials'

const { Text, Paragraph } = Typography
const VERDICTS = ['supported', 'refuted', 'unverifiable']
const VERDICT_COLOR = { supported: 'green', refuted: 'red', unverifiable: 'gold' }

const VerifyWorkspace = ({ project, canEdit, steps, renderSection, materialSet = 'campus' }) => {
  const { t, i18n } = useTranslation()
  const { updateProject, recordEvent } = useAiLabStore()
  const verify = project?.context?.verify || {}
  const materials = useMemo(() => getVerifyMaterials(i18n.language, materialSet), [i18n.language, materialSet])
  const [materialId, setMaterialId] = useState(verify.material?.id || materials[0]?.id)
  const [custom, setCustom] = useState({ title: '', source: '', draft: '' })
  const [claims, setClaims] = useState(verify.claims || [])
  const [newClaim, setNewClaim] = useState('')
  const [revision, setRevision] = useState(verify.revision || '')
  const [reflection, setReflection] = useState(verify.reflection || { wrong: '', how: '', next: '' })
  const [saving, setSaving] = useState(null)

  useEffect(() => {
    const v = project?.context?.verify || {}
    setMaterialId(v.material?.id || materials[0]?.id)
    setClaims(v.claims || [])
    setRevision(v.revision || '')
    setReflection(v.reflection || { wrong: '', how: '', next: '' })
    // 只在项目切换时同步一次，不依赖 t
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id])

  const persist = async (patch, step) => {
    setSaving(step)
    try {
      await updateProject({ context: { ...(project.context || {}), verify: { ...(project.context?.verify || {}), ...patch } } })
      return true
    } catch (err) {
      message.error(t('aiLab.verify.saveFailed'))
      return false
    } finally {
      setSaving(null)
    }
  }

  const material = verify.material || null
  const chosen = materials.find((m) => m.id === materialId)
  const saveMaterial = async () => {
    const m = materialId === 'custom'
      ? { id: 'custom', title: custom.title.trim(), source: custom.source.trim(), draft: custom.draft.trim(), seeded: 0 }
      : { id: chosen.id, title: chosen.title, source: chosen.source, draft: chosen.draft, seeded: chosen.errors.length }
    if (!m.title || !m.source || !m.draft) { message.warning(t('aiLab.verify.materialRequired')); return }
    if (await persist({ material: m, claims: [], revision: '', reflection: null }, 'material')) {
      setClaims([]); setRevision('')
      recordEvent('reflection.write', { step: 'material', material_id: m.id, title: m.title })
      message.success(t('aiLab.verify.materialSaved'))
    }
  }

  const addClaim = () => {
    const text = newClaim.trim()
    if (!text) return
    setClaims((c) => [...c, { id: `c${Date.now()}`, text, verdict: null, evidence: '' }])
    setNewClaim('')
  }
  const saveClaims = async () => {
    if (!claims.length) { message.warning(t('aiLab.verify.claimsRequired')); return }
    if (await persist({ claims }, 'claims')) {
      recordEvent('claim.write', { count: claims.length, claims: claims.map((c) => c.text) })
      message.success(t('aiLab.verify.claimsSaved', { count: claims.length }))
    }
  }
  const saveVerdicts = async () => {
    const undecided = claims.filter((c) => !c.verdict)
    if (undecided.length) { message.warning(t('aiLab.verify.verdictRequired', { count: undecided.length })); return }
    if (await persist({ claims }, 'verdicts')) {
      const counts = { supported: 0, refuted: 0, unverifiable: 0 }
      claims.forEach((c) => { counts[c.verdict] += 1 })
      recordEvent('claim.verify', { counts, claims: claims.map((c) => ({ text: c.text, verdict: c.verdict, evidence: c.evidence })) })
      message.success(t('aiLab.verify.verdictsSaved'))
    }
  }
  const saveRevision = async () => {
    if (!revision.trim()) { message.warning(t('aiLab.verify.revisionRequired')); return }
    if (await persist({ revision: revision.trim() }, 'revise')) {
      recordEvent('claim.revise', { length: revision.trim().length, changed: revision.trim() !== (material?.draft || '') })
      message.success(t('aiLab.verify.revisionSaved'))
    }
  }
  const saveReflection = async () => {
    if (!reflection.wrong.trim() || !reflection.how.trim()) { message.warning(t('aiLab.verify.reflectionRequired')); return }
    if (await persist({ reflection }, 'reflection')) {
      recordEvent('reflection.write', { step: 'verify', ...reflection })
      message.success(t('aiLab.verify.reflectionSaved'))
    }
  }

  const verdictCounts = { supported: 0, refuted: 0, unverifiable: 0 }
  ;(verify.claims || []).forEach((c) => { if (c.verdict) verdictCounts[c.verdict] += 1 })
  const seededMaterial = material && material.id !== 'custom' ? materials.find((m) => m.id === material.id) : null

  const materialSection = renderSection('material', t('aiLab.step.material'), t('aiLab.verify.materialHint'), (
    <div>
      {canEdit && (
        <Radio.Group value={materialId} onChange={(e) => setMaterialId(e.target.value)} style={{ marginBottom: 12 }}>
          <Space wrap>
            {materials.map((m) => <Radio.Button key={m.id} value={m.id}>{m.title}</Radio.Button>)}
            <Radio.Button value="custom">{t('aiLab.verify.customMaterial')}</Radio.Button>
          </Space>
        </Radio.Group>
      )}
      {canEdit && materialId === 'custom' && (
        <Space direction="vertical" style={{ width: '100%', marginBottom: 12 }}>
          <Input maxLength={60} placeholder={t('aiLab.verify.customTitle')} value={custom.title} onChange={(e) => setCustom((c) => ({ ...c, title: e.target.value }))} />
          <Input.TextArea rows={5} maxLength={3000} placeholder={t('aiLab.verify.customSource')} value={custom.source} onChange={(e) => setCustom((c) => ({ ...c, source: e.target.value }))} />
          <Input.TextArea rows={5} maxLength={3000} placeholder={t('aiLab.verify.customDraft')} value={custom.draft} onChange={(e) => setCustom((c) => ({ ...c, draft: e.target.value }))} />
        </Space>
      )}
      {(material || (canEdit && materialId !== 'custom' && chosen)) && (
        <div className="ailab-verify-material">
          <div className="ailab-verify-col">
            <div className="ailab-verify-label"><Tag color="green">{t('aiLab.verify.sourceLabel')}</Tag>{t('aiLab.verify.sourceHint')}</div>
            <Paragraph className="ailab-verify-text">{(material && (!canEdit || material.id === materialId) ? material : chosen)?.source}</Paragraph>
          </div>
          <div className="ailab-verify-col">
            <div className="ailab-verify-label"><Tag color="volcano">{t('aiLab.verify.draftLabel')}</Tag>{t('aiLab.verify.draftHint')}</div>
            <Paragraph className="ailab-verify-text">{(material && (!canEdit || material.id === materialId) ? material : chosen)?.draft}</Paragraph>
          </div>
        </div>
      )}
      {canEdit && <Button type="primary" onClick={saveMaterial} loading={saving === 'material'}>{material ? t('aiLab.verify.materialReplace') : t('aiLab.verify.materialUse')}</Button>}
      {material && <Tag style={{ marginLeft: 8 }}>{t('aiLab.verify.materialCurrent', { title: material.title })}</Tag>}
    </div>
  ))

  const claimsSection = renderSection('claims', t('aiLab.step.claims'), t('aiLab.verify.claimsHint'), (
    <div>
      {!material && <Alert type="info" showIcon message={t('aiLab.verify.needMaterial')} />}
      {material && (
        <>
          <ol className="ailab-claim-list">
            {claims.map((c, i) => (
              <li key={c.id}>
                <span>{c.text}</span>
                {canEdit && <Button size="small" type="text" icon={<DeleteOutlined />} onClick={() => setClaims((list) => list.filter((_, j) => j !== i))} />}
              </li>
            ))}
          </ol>
          {canEdit && (
            <Space.Compact style={{ width: '100%', maxWidth: 640, marginBottom: 10 }}>
              <Input value={newClaim} maxLength={200} placeholder={t('aiLab.verify.claimPlaceholder')} onChange={(e) => setNewClaim(e.target.value)} onPressEnter={addClaim} />
              <Button icon={<PlusOutlined />} onClick={addClaim}>{t('aiLab.verify.addClaim')}</Button>
            </Space.Compact>
          )}
          {canEdit && <div><Button type="primary" onClick={saveClaims} loading={saving === 'claims'} disabled={!claims.length}>{t('aiLab.verify.saveClaims')}</Button></div>}
        </>
      )}
    </div>
  ))

  const verdictsSection = renderSection('verdicts', t('aiLab.step.verdicts'), t('aiLab.verify.verdictsHint'), (
    <div>
      {!(verify.claims || []).length && <Alert type="info" showIcon message={t('aiLab.verify.needClaims')} />}
      {(verify.claims || []).length > 0 && (
        <>
          <Table
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={claims}
            columns={[
              { title: t('aiLab.verify.claimCol'), dataIndex: 'text', width: '40%' },
              { title: t('aiLab.verify.verdictCol'), width: 160, render: (_, c, i) => (
                <Select size="small" value={c.verdict || undefined} disabled={!canEdit} style={{ width: 140 }} placeholder={t('aiLab.verify.choose')}
                  options={VERDICTS.map((v) => ({ value: v, label: t(`aiLab.verify.verdict.${v}`) }))}
                  onChange={(v) => setClaims((list) => list.map((x, j) => (j === i ? { ...x, verdict: v } : x)))} />
              ) },
              { title: t('aiLab.verify.evidenceCol'), render: (_, c, i) => (
                <Input size="small" value={c.evidence} disabled={!canEdit} maxLength={300} placeholder={t('aiLab.verify.evidencePlaceholder')}
                  onChange={(e) => setClaims((list) => list.map((x, j) => (j === i ? { ...x, evidence: e.target.value } : x)))} />
              ) }
            ]}
          />
          <Space wrap style={{ marginTop: 10 }}>
            {VERDICTS.map((v) => <Tag key={v} color={VERDICT_COLOR[v]}>{t(`aiLab.verify.verdict.${v}`)} {claims.filter((c) => c.verdict === v).length}</Tag>)}
            {canEdit && <Button type="primary" onClick={saveVerdicts} loading={saving === 'verdicts'}>{t('aiLab.verify.saveVerdicts')}</Button>}
          </Space>
        </>
      )}
    </div>
  ))

  const reviseSection = renderSection('revise', t('aiLab.step.revise'), t('aiLab.verify.reviseHint'), (
    <div>
      {!verdictCounts.supported && !verdictCounts.refuted && !verdictCounts.unverifiable && <Alert type="info" showIcon message={t('aiLab.verify.needVerdicts')} style={{ marginBottom: 10 }} />}
      <Input.TextArea rows={7} maxLength={3000} value={revision || material?.draft || ''} disabled={!canEdit} onChange={(e) => setRevision(e.target.value)} />
      {canEdit && <Button type="primary" style={{ marginTop: 8 }} onClick={saveRevision} loading={saving === 'revise'}>{t('aiLab.verify.saveRevision')}</Button>}
      {verify.revision && seededMaterial && (
        <Collapse size="small" style={{ marginTop: 12 }} items={[{
          key: 'reveal',
          label: t('aiLab.verify.reveal', { errors: seededMaterial.errors.length, refuted: verdictCounts.refuted }),
          children: (
            <div>
              <Text strong>{t('aiLab.verify.seededErrors')}</Text>
              <ul>{seededMaterial.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              <Text strong>{t('aiLab.verify.seededUnverifiable')}</Text>
              <ul>{seededMaterial.unverifiable.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )
        }]} />
      )}
    </div>
  ))

  const reflectionSection = renderSection('reflection', t('aiLab.step.reflection'), t('aiLab.verify.reflectionHint'), (
    <Space direction="vertical" style={{ width: '100%' }}>
      {['wrong', 'how', 'next'].map((k) => (
        <div key={k} className="ailab-field">
          <label>{t(`aiLab.verify.reflect.${k}`)}</label>
          <Input.TextArea rows={2} maxLength={500} value={reflection[k]} disabled={!canEdit} onChange={(e) => setReflection((r) => ({ ...r, [k]: e.target.value }))} />
        </div>
      ))}
      {canEdit && <Button type="primary" onClick={saveReflection} loading={saving === 'reflection'}>{t('aiLab.verify.saveReflection')}</Button>}
    </Space>
  ))

  const sections = { material: materialSection, claims: claimsSection, verdicts: verdictsSection, revise: reviseSection, reflection: reflectionSection }
  return <>{(steps || Object.keys(sections)).map((s) => sections[s] || null)}</>
}

export default VerifyWorkspace
