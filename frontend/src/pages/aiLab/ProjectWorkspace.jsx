/**
 * AI训练专区 · 实验工作台
 *
 * 一个项目 = 一个实验。步骤由任务模板决定（task.steps），按数据类型切换面板：
 *  - 图像（image-knn）：预测 → 采集/导入 → 锁定留出集 → 训练 → 留出测试 → 换条件测试 → 错误分析 → 对照 → 模型卡
 *    附加实验步骤：import_preset（导入预置包）、mislabel/restore（喂错数据）、data_card（数据卡）
 *  - 表格（table-tree / table-rules）：导入 → 锁定 → 手写规则 → 训练决策树 → 留出/换条件测试 → 对照 → 模型卡
 *  - 文本核实（verify）：材料 → 拆说法 → 判定 → 改写 → 反思
 * 左侧步骤栏按真实数据判断完成状态；每一步的关键动作都写一条过程事实（aiLabStore.recordEvent）。
 * 非所有者（教师/管理员）只读，可看时间线。
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Steps, Card, Spin, Button, Space, Tag, Select, Alert, Typography, message } from 'antd'
import { ArrowLeftOutlined, LockOutlined, PlusOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAiLabStore from '../../stores/aiLabStore'
import useAuthStore from '../../stores/authStore'
import PredictionCard from './components/PredictionCard'
import DatasetPanel from './components/DatasetPanel'
import CapturePanel from './components/CapturePanel'
import TrainPanel from './components/TrainPanel'
import EvaluatePanel from './components/EvaluatePanel'
import ConditionTable from './components/ConditionTable'
import ComparePanel from './components/ComparePanel'
import ModelCardForm from './components/ModelCardForm'
import Timeline from './components/Timeline'
import ImportPresetModal from './components/ImportPresetModal'
import MislabelPanel from './components/MislabelPanel'
import DataCardForm from './components/DataCardForm'
import TablePanel from './components/TablePanel'
import RuleEditor from './components/RuleEditor'
import TreeTrainPanel from './components/TreeTrainPanel'
import TableEvaluatePanel from './components/TableEvaluatePanel'
import SampleCurve from './components/SampleCurve'
import VerifyWorkspace from './components/VerifyWorkspace'
import './AiLab.less'

const { Title, Text } = Typography
const DEFAULT_STEPS = ['predict', 'collect', 'lock', 'train', 'test_holdout', 'test_shift', 'errors', 'iterate', 'model_card']
const DEFAULT_HOLDOUT_RATIO = 0.2

const ProjectWorkspace = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const { user } = useAuthStore()
  const {
    project, datasets, models, samplesByDataset, projectLoading, tasks, events,
    openProject, fetchTasks, fetchSamples, uploadSamples, deleteSample, lockSplit, addRows,
    updateDataset, updateProject, recordEvent, flushEvents, reset
  } = useAiLabStore()
  const [locking, setLocking] = useState(false)
  const [errorsViewed, setErrorsViewed] = useState(false)
  const [presetOpen, setPresetOpen] = useState(false)
  const openedRef = useRef(null)

  useEffect(() => {
    if (!tasks.length) fetchTasks()
    openProject(id).catch(() => navigate('/ai-lab'))
    return () => { flushEvents(); reset() }
    // 只在项目 id 变化时重新加载；不依赖 t
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (project && openedRef.current !== project.id) {
      openedRef.current = project.id
      recordEvent('task.open', {
        task_key: project.task_key,
        task_version: project.task_version,
        participation_mode: project.participation_mode,
        context: project.context || null
      })
    }
  }, [project, recordEvent])

  const dataset = datasets[0]
  useEffect(() => {
    if (dataset?.id && !samplesByDataset[dataset.id]) fetchSamples(dataset.id).catch(() => {})
  }, [dataset?.id, samplesByDataset, fetchSamples])

  const task = useMemo(() => tasks.find((x) => x.key === project?.task_key) || null, [tasks, project?.task_key])
  const kind = task?.kind || dataset?.kind || 'image'
  const steps = useMemo(() => Array.from(new Set(task?.steps || DEFAULT_STEPS)), [task])
  const minPerClass = task?.min_train_per_class || 10
  const config = task?.config || {}
  const canEdit = !!(project && user && project.user_id === user.id)
  const classes = dataset?.classes || []
  const labelOf = useCallback((key) => classes.find((c) => c.key === key)?.label || key, [classes])
  const taskTitle = (key) => (i18n.exists(`aiLab.task.${key}.title`) ? t(`aiLab.task.${key}.title`) : (task?.title || key))
  const samples = samplesByDataset[dataset?.id] || []

  const counts = dataset?.counts || { train: {}, holdout: {}, shift: {} }
  const trainTotal = Object.values(counts.train || {}).reduce((a, b) => a + b, 0)
  const classesReady = classes.filter((c) => (counts.train?.[c.key] || 0) >= minPerClass).length
  const hasShiftTest = models.some((m) => Object.keys(m.metrics?.shift || {}).length > 0)
  const hasHoldoutTest = models.some((m) => typeof m.metrics?.holdout?.accuracy === 'number')
  const latestCard = models[models.length - 1]?.model_card
  const mislabeledCount = samples.filter((s) => s.split === 'train' && s.original_class_key).length
  const hasEvent = (type) => events.some((e) => e.type === type)
  const verify = project?.context?.verify || {}

  const stepDone = {
    predict: !!project?.context?.prediction,
    collect: classes.length >= 2 && classesReady >= 2,
    import_preset: trainTotal > 0 && (samples.some((s) => s.source === 'preset') || hasEvent('preset.import')),
    data_card: !!project?.context?.data_card?.goal,
    lock: !!dataset?.locked_at,
    rules: models.some((m) => m.engine === 'table-rules'),
    train: models.some((m) => m.engine !== 'table-rules'),
    test_holdout: hasHoldoutTest,
    test_shift: hasShiftTest,
    condition_design: (project?.context?.condition_table || []).length > 0,
    errors: errorsViewed || hasShiftTest || hasEvent('error.view'),
    mislabel: mislabeledCount > 0 || hasEvent('dataset.mislabel'),
    restore: hasEvent('dataset.restore') && mislabeledCount === 0,
    iterate: models.length > 1,
    compare: models.length > 1,
    model_card: !!latestCard?.scope,
    material: !!verify.material,
    claims: (verify.claims || []).length > 0,
    verdicts: (verify.claims || []).length > 0 && verify.claims.every((c) => c.verdict),
    revise: !!verify.revision,
    reflection: !!verify.reflection?.wrong
  }
  const firstOpen = steps.findIndex((s) => !stepDone[s])
  const currentStep = firstOpen === -1 ? steps.length - 1 : firstOpen

  const scrollTo = (key) => document.getElementById(`ailab-step-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const handleTrainUpload = async (blobs, meta) => {
    const created = await uploadSamples(dataset.id, blobs, meta)
    recordEvent('dataset.add', { dataset_id: dataset.id, split: 'train', class_key: meta.class_key, count: created.length, condition_tags: meta.condition_tags, source: meta.source, dataset_version: dataset.version })
  }
  const handleDeleteSample = async (sample) => {
    await deleteSample(sample)
    recordEvent('dataset.remove', { dataset_id: dataset.id, sample_id: sample.id, class_key: sample.class_key, split: sample.split })
  }
  const handleAddClass = async (cls) => {
    await updateDataset(dataset.id, { classes: [...classes, cls] })
  }
  const handleRenameClass = async (key, label) => {
    if (!label) return
    await updateDataset(dataset.id, { classes: classes.map((c) => (c.key === key ? { ...c, label } : c)) })
    recordEvent('dataset.relabel', { dataset_id: dataset.id, class_key: key, label })
  }
  const handleAddRow = async (row) => {
    const created = await addRows(dataset.id, [row])
    recordEvent('dataset.add', { dataset_id: dataset.id, split: 'train', class_key: row.class_key, count: created.length, source: 'manual', dataset_version: dataset.version })
  }
  const handleLock = async () => {
    setLocking(true)
    try {
      const result = await lockSplit(dataset.id, DEFAULT_HOLDOUT_RATIO)
      recordEvent('split.lock', { dataset_id: dataset.id, holdout_ratio: DEFAULT_HOLDOUT_RATIO, dataset_version: result?.dataset?.version, counts: result?.counts })
      message.success(t('aiLab.lock.done'))
    } catch (err) {
      message.error(t('aiLab.lock.failed'))
    } finally {
      setLocking(false)
    }
  }

  if (projectLoading || !project) {
    return <div className="ailab-loading"><Spin size="large" /></div>
  }

  const section = (key, title, hint, children, extra) => (
    <Card id={`ailab-step-${key}`} className={`ailab-section ${stepDone[key] ? 'done' : ''}`} key={key}
      title={<span><span className="ailab-section-no">{steps.indexOf(key) + 1}</span>{title}</span>} extra={extra}>
      {hint && <p className="ailab-section-hint">{hint}</p>}
      {children}
    </Card>
  )

  const predictPrompt = i18n.exists(`aiLab.task.${project.task_key}.predictPrompt`) ? t(`aiLab.task.${project.task_key}.predictPrompt`) : t('aiLab.task.free.predictPrompt')
  const isTable = kind === 'table'
  const presetButton = canEdit && (task?.presets?.length > 0 || isTable) && (
    <Button size="small" icon={<PlusOutlined />} onClick={() => setPresetOpen(true)}>{t('aiLab.preset.buttonOpen')}</Button>
  )
  const dataView = isTable
    ? <TablePanel dataset={dataset} samples={samples} canEdit={canEdit} labelOf={labelOf} onAddRow={handleAddRow} />
    : <DatasetPanel dataset={dataset} samples={samples} onAddClass={handleAddClass} onRenameClass={handleRenameClass} onDeleteSample={handleDeleteSample} canEdit={canEdit} />

  const lockSection = () => section('lock', t('aiLab.step.lock'), t('aiLab.section.lockHint'), (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Text>{t(isTable ? 'aiLab.lock.countsRows' : 'aiLab.lock.counts', { train: trainTotal, holdout: Object.values(counts.holdout || {}).reduce((a, b) => a + b, 0) })}</Text>
      {dataset?.locked_at && <Tag icon={<LockOutlined />} color="blue">{t('aiLab.lock.locked', { version: dataset.version })}</Tag>}
      {canEdit && (
        <Button type="primary" icon={<LockOutlined />} onClick={handleLock} loading={locking} disabled={trainTotal < 4 || classes.length < 2}>
          {dataset?.locked_at ? t('aiLab.lock.relock') : t('aiLab.lock.button')}
        </Button>
      )}
    </Space>
  ))

  const sections = {
    predict: () => section('predict', t('aiLab.step.predict'), null, <PredictionCard project={project} prompt={predictPrompt} canEdit={canEdit} />),
    data_card: () => section('data_card', t('aiLab.step.data_card'), t('aiLab.section.dataCardHint'), <DataCardForm project={project} canEdit={canEdit} />),
    collect: () => section('collect', t('aiLab.step.collect'), t('aiLab.section.collectHint', { min: minPerClass }), (
      <>
        {dataView}
        {canEdit && !isTable && classes.length > 0 && <CapturePanel dataset={dataset} classes={classes} split="train" onUpload={handleTrainUpload} />}
      </>
    ), presetButton),
    import_preset: () => section('import_preset', t('aiLab.step.import_preset'), t(isTable ? 'aiLab.section.importTableHint' : 'aiLab.section.importHint'), (
      <>
        {canEdit && trainTotal === 0 && (
          <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('aiLab.section.importEmpty')}
            action={<Button size="small" type="primary" onClick={() => setPresetOpen(true)}>{t('aiLab.preset.buttonOpen')}</Button>} />
        )}
        {dataView}
      </>
    ), presetButton),
    lock: lockSection,
    rules: () => section('rules', t('aiLab.step.rules'), t('aiLab.section.rulesHint'), (
      <RuleEditor dataset={dataset} samples={samples} models={models} project={project} canEdit={canEdit} labelOf={labelOf} />
    )),
    train: () => section('train', t('aiLab.step.train'), t(isTable ? 'aiLab.section.treeHint' : 'aiLab.section.trainHint'), (
      isTable
        ? <TreeTrainPanel dataset={dataset} samples={samples} models={models} canEdit={canEdit} labelOf={labelOf} depthOptions={config.max_depth_options} />
        : <TrainPanel dataset={dataset} models={models} minPerClass={minPerClass} canEdit={canEdit} perClassLimits={config.per_class_limits} extraParams={steps.includes('mislabel') ? { mislabeled_count: mislabeledCount } : undefined} />
    )),
    test_holdout: () => section('test_holdout', t('aiLab.step.test_holdout'), t('aiLab.section.testHint'), (
      isTable
        ? <TableEvaluatePanel dataset={dataset} models={models} labelOf={labelOf} canEdit={canEdit} />
        : <EvaluatePanel dataset={dataset} models={models} labelOf={labelOf} canEdit={canEdit} />
    )),
    test_shift: () => section('test_shift', t('aiLab.step.test_shift'), t(isTable ? 'aiLab.section.shiftRowsHint' : 'aiLab.section.shiftHint'), <Text type="secondary">{t('aiLab.section.shiftWhere')}</Text>),
    condition_design: () => section('condition_design', t('aiLab.step.condition_design'), t('aiLab.section.conditionHint'), <ConditionTable project={project} models={models} canEdit={canEdit} />),
    errors: () => section('errors', t('aiLab.step.errors'), t(isTable ? 'aiLab.section.errorsRowsHint' : 'aiLab.section.errorsHint'), (
      <Space>
        <Text type="secondary">{t('aiLab.section.errorsWhere')}</Text>
        {canEdit && !errorsViewed && <Button size="small" onClick={() => { setErrorsViewed(true); recordEvent('reflection.write', { step: 'errors', text: 'viewed' }) }}>{t('aiLab.section.errorsMark')}</Button>}
      </Space>
    )),
    mislabel: () => section('mislabel', t('aiLab.step.mislabel'), t('aiLab.section.mislabelHint'), (
      <MislabelPanel mode="mislabel" dataset={dataset} samples={samples} models={models} canEdit={canEdit} ratio={config.mislabel_ratio || 0.2} labelOf={labelOf} />
    )),
    restore: () => section('restore', t('aiLab.step.restore'), t('aiLab.section.restoreHint'), (
      <MislabelPanel mode="restore" dataset={dataset} samples={samples} models={models} canEdit={canEdit} ratio={config.mislabel_ratio || 0.2} labelOf={labelOf} />
    )),
    iterate: () => section('iterate', t('aiLab.step.iterate'), t(config.per_class_limits ? 'aiLab.section.curveHint' : 'aiLab.section.iterateHint'), (
      <>
        {config.per_class_limits && <SampleCurve models={models} limits={config.per_class_limits} />}
        <ComparePanel models={models} />
      </>
    )),
    compare: () => section('compare', t('aiLab.step.compare'), t('aiLab.section.compareHint'), <ComparePanel models={models} />),
    model_card: () => section('model_card', t('aiLab.step.model_card'), t('aiLab.section.modelCardHint'), <ModelCardForm models={models} canEdit={canEdit} />)
  }

  return (
    <div className="ailab-page ailab-workspace-page">
      <div className="ailab-workspace-head">
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/ai-lab')}>{t('common.back')}</Button>
          <Title level={4} style={{ margin: 0 }}>{project.title}</Title>
          <Tag color="geekblue">{taskTitle(project.task_key)}</Tag>
          <Tag>{t(`aiLab.kind.${kind}`)}</Tag>
          {!canEdit && <Tag>{t('aiLab.workspace.readOnly')}</Tag>}
        </Space>
        <Space>
          <Text type="secondary">{t('aiLab.form.participation')}</Text>
          <Select
            size="small"
            value={project.participation_mode}
            disabled={!canEdit}
            onChange={(v) => updateProject({ participation_mode: v })}
            options={['individual', 'group', 'projected'].map((m) => ({ value: m, label: t(`aiLab.participation.${m}`) }))}
            style={{ width: 130 }}
          />
        </Space>
      </div>
      {!canEdit && <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('aiLab.workspace.readOnlyHint')} />}
      <div className="ailab-workspace">
        <aside className="ailab-rail">
          <Steps
            direction="vertical"
            size="small"
            current={currentStep}
            onChange={(i) => scrollTo(steps[i])}
            items={steps.map((s) => ({ title: t(`aiLab.step.${s}`), status: stepDone[s] ? 'finish' : undefined }))}
          />
        </aside>
        <main className="ailab-main">
          {kind === 'text'
            ? <VerifyWorkspace project={project} canEdit={canEdit} steps={steps} renderSection={section} />
            : steps.map((s) => (sections[s] ? sections[s]() : null))}
          <Card className="ailab-section" title={t('aiLab.timeline.title')}>
            <Timeline />
          </Card>
        </main>
      </div>
      {dataset && (
        <ImportPresetModal open={presetOpen} onClose={() => setPresetOpen(false)} dataset={dataset} task={task} kind={isTable ? 'table' : 'image'} />
      )}
    </div>
  )
}

export default ProjectWorkspace
