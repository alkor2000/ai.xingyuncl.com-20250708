/**
 * AI训练专区 · 首页：我的实验列表、新建实验（选任务模板）、教师查看本组实验
 */
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Modal, Form, Input, Radio, Tag, Spin, Tabs, Table, Typography, Space, Progress, message } from 'antd'
import { PlusOutlined, ExperimentOutlined } from '@ant-design/icons'
import { kindMeta, GRADE_COLORS } from './stepMeta.jsx'
import { useTranslation } from 'react-i18next'
import useAiLabStore from '../../stores/aiLabStore'
import useAuthStore from '../../stores/authStore'
import { formatPercent } from './engine/metrics'
import './AiLab.less'

const { Title, Text, Paragraph } = Typography
const GRADE_BANDS = ['L', 'P', 'M', 'H']

const AiLab = () => {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { tasks, projects, projectsLoading, adminProjects, fetchTasks, fetchProjects, fetchAdminProjects, createProject } = useAiLabStore()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form] = Form.useForm()
  const isTeacher = user?.role === 'admin' || user?.role === 'super_admin'

  useEffect(() => { fetchTasks(); fetchProjects() }, [fetchTasks, fetchProjects])

  const taskTitle = (task) => (i18n.exists(`aiLab.task.${task.key}.title`) ? t(`aiLab.task.${task.key}.title`) : task.title)
  const taskDesc = (task) => (i18n.exists(`aiLab.task.${task.key}.desc`) ? t(`aiLab.task.${task.key}.desc`) : (task.description || ''))

  const handleCreate = async (values) => {
    setCreating(true)
    try {
      const data = await createProject(values)
      const projectId = data?.project?.id || data?.id
      message.success(t('aiLab.msg.created'))
      setOpen(false)
      form.resetFields()
      navigate(`/ai-lab/projects/${projectId}`)
    } catch (err) {
      message.error(t('aiLab.msg.createFailed'))
    } finally {
      setCreating(false)
    }
  }

  const taskOf = (key) => tasks.find((x) => x.key === key)
  /* 粗略进度：有样本 1/4，有版本 2/4，测过留出集 3/4，测过换条件集 4/4 */
  const progressOf = (p) => {
    const sm = p.summary || {}
    let n = 0
    if ((sm.sample_count ?? 0) > 0) n += 1
    if ((sm.model_count ?? 0) > 0) n += 1
    if (typeof sm.best_holdout_accuracy === 'number') n += 1
    if (typeof sm.generalization_gap === 'number') n += 1
    return Math.round((n / 4) * 100)
  }
  const projectCard = (p) => {
    const kind = taskOf(p.task_key)?.kind || 'image'
    const km = kindMeta(kind)
    const acc = p.summary?.best_holdout_accuracy
    return (
      <Card key={p.id} hoverable className="ailab-project-card" style={{ '--kind-color': km.color }} onClick={() => navigate(`/ai-lab/projects/${p.id}`)}>
        <div className="ailab-project-top">
          <span className="ailab-kind-icon"><km.icon /></span>
          <div style={{ minWidth: 0 }}>
            <div className="ailab-project-title">{p.title}</div>
            <Text type="secondary" className="ailab-muted">{i18n.exists(`aiLab.task.${p.task_key}.title`) ? t(`aiLab.task.${p.task_key}.title`) : p.task_key} · {t(`aiLab.participation.${p.participation_mode}`)}</Text>
          </div>
        </div>
        <div className="ailab-project-progress"><Progress percent={progressOf(p)} size="small" showInfo={false} strokeColor={km.color} /></div>
        <div className="ailab-project-stats">
          <span>{t('aiLab.card.samples', { count: p.summary?.sample_count ?? 0 })}</span>
          <span>{t('aiLab.card.models', { count: p.summary?.model_count ?? 0 })}</span>
          <span>{typeof acc === 'number' ? t('aiLab.card.holdout', { value: formatPercent(acc) }) : t('aiLab.card.notTested')}</span>
          <span>{typeof p.summary?.generalization_gap === 'number' ? t('aiLab.card.gap', { value: formatPercent(p.summary.generalization_gap) }) : ''}</span>
        </div>
        <Text type="secondary" className="ailab-muted">{new Date(p.updated_at).toLocaleString(i18n.language)}</Text>
      </Card>
    )
  }
  const emptyHero = (
    <div className="ailab-empty-hero">
      <svg viewBox="0 0 140 140" aria-hidden="true">
        <defs><linearGradient id="ailabFlask" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f28c28" /><stop offset="1" stopColor="#e64980" /></linearGradient></defs>
        <path d="M54 18h32v10h-6v26l30 46a10 10 0 0 1-8 15H38a10 10 0 0 1-8-15l30-46V28h-6z" fill="#fff" stroke="#1f2a37" strokeWidth="4" strokeLinejoin="round" />
        <path d="M46 84h48l16 24a4 4 0 0 1-3 6H33a4 4 0 0 1-3-6z" fill="url(#ailabFlask)" />
        <circle cx="62" cy="98" r="4" fill="#fff" opacity="0.8" /><circle cx="78" cy="104" r="3" fill="#fff" opacity="0.8" /><circle cx="70" cy="90" r="2.5" fill="#fff" opacity="0.8" />
        <path d="M104 22l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="#f59f00" /><path d="M26 44l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#12b886" />
      </svg>
      <h3>{t('aiLab.emptyTitle')}</h3>
      <p>{t('aiLab.empty')}</p>
      <Button type="primary" size="large" icon={<PlusOutlined />} onClick={() => setOpen(true)}>{t('aiLab.newProject')}</Button>
    </div>
  )

  const myTab = (
    <div>
      {projectsLoading ? <div className="ailab-loading"><Spin /></div> : (
        projects.length ? <div className="ailab-project-grid">{projects.map(projectCard)}</div> : emptyHero
      )}
    </div>
  )

  const adminTab = (
    <Table
      size="small"
      rowKey="id"
      dataSource={adminProjects}
      onRow={(p) => ({ onClick: () => navigate(`/ai-lab/projects/${p.id}`), style: { cursor: 'pointer' } })}
      columns={[
        { title: t('aiLab.admin.title'), dataIndex: 'title' },
        { title: t('aiLab.admin.student'), render: (_, p) => p.nickname || p.username || p.user_id },
        { title: t('aiLab.admin.task'), dataIndex: 'task_key', render: (k) => (i18n.exists(`aiLab.task.${k}.title`) ? t(`aiLab.task.${k}.title`) : k) },
        { title: t('aiLab.admin.mode'), dataIndex: 'participation_mode', render: (m) => t(`aiLab.participation.${m}`) },
        { title: t('aiLab.admin.models'), render: (_, p) => p.summary?.model_count ?? 0 },
        { title: t('aiLab.admin.holdout'), render: (_, p) => formatPercent(p.summary?.best_holdout_accuracy) },
        { title: t('aiLab.admin.gap'), render: (_, p) => formatPercent(p.summary?.generalization_gap) },
        { title: t('aiLab.admin.updated'), dataIndex: 'updated_at', render: (v) => new Date(v).toLocaleString(i18n.language) }
      ]}
      pagination={false}
    />
  )

  return (
    <div className="ailab-page">
      <div className="ailab-head">
        <div className="ailab-head-hero">
          <span className="ailab-kind-icon"><ExperimentOutlined /></span>
          <div>
            <Title level={3} style={{ margin: 0 }}>{t('aiLab.title')}</Title>
            <Paragraph type="secondary" style={{ margin: '4px 0 0' }}>{t('aiLab.subtitle')}</Paragraph>
          </div>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>{t('aiLab.newProject')}</Button>
      </div>
      {isTeacher ? (
        <Tabs
          items={[
            { key: 'mine', label: t('aiLab.myProjects'), children: myTab },
            { key: 'group', label: t('aiLab.groupProjects'), children: adminTab }
          ]}
          onChange={(k) => { if (k === 'group') fetchAdminProjects() }}
        />
      ) : myTab}

      <Modal
        title={t('aiLab.newProject')}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={creating}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        width={720}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate} initialValues={{ task_key: tasks[0]?.key || 'P1', participation_mode: 'individual' }}>
          <Form.Item name="task_key" label={t('aiLab.form.task')} rules={[{ required: true }]}>
            <Radio.Group style={{ width: '100%' }}>
              {GRADE_BANDS.filter((g) => tasks.some((task) => (task.grade_band || 'P') === g)).map((g) => (
                <div className="ailab-task-group" key={g}>
                  <div className="ailab-task-group-title"><span className="ailab-grade-pill" style={{ '--grade-color': GRADE_COLORS[g] }}>{t(`aiLab.grade.${g}`)}</span></div>
                  <div className="ailab-task-radio">
                    {tasks.filter((task) => (task.grade_band || 'P') === g).map((task) => (
                      <Radio.Button key={task.key} value={task.key} className="ailab-task-option" style={{ '--kind-color': kindMeta(task.kind || 'image').color }}>
                        <div className="ailab-task-option-title">{React.createElement(kindMeta(task.kind || 'image').icon)} {taskTitle(task)}</div>
                        <div className="ailab-task-option-desc">{taskDesc(task)}</div>
                        <div className="ailab-task-option-meta">
                          <Tag>{t(`aiLab.kind.${task.kind || 'image'}`)}</Tag>
                          {task.hours && <Tag>{t('aiLab.form.hours', { hours: task.hours })}</Tag>}
                          {task.presets?.length > 0 && <Tag color="cyan">{t('aiLab.form.hasPresets')}</Tag>}
                        </div>
                      </Radio.Button>
                    ))}
                  </div>
                </div>
              ))}
            </Radio.Group>
          </Form.Item>
          <Form.Item name="title" label={t('aiLab.form.title')} rules={[{ required: true, message: t('aiLab.form.titleRequired') }]}>
            <Input maxLength={100} placeholder={t('aiLab.form.titlePlaceholder')} />
          </Form.Item>
          <Form.Item name="participation_mode" label={t('aiLab.form.participation')} tooltip={t('aiLab.form.participationTip')}>
            <Radio.Group options={['individual', 'group', 'projected'].map((m) => ({ value: m, label: t(`aiLab.participation.${m}`) }))} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default AiLab
