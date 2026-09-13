/**
 * AI训练专区 · 首页：我的实验列表、新建实验（选任务模板）、教师查看本组实验
 */
import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Modal, Form, Input, Radio, Tag, Empty, Spin, Tabs, Table, Typography, Space, message } from 'antd'
import { PlusOutlined, ExperimentOutlined } from '@ant-design/icons'
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

  const projectCard = (p) => (
    <Card key={p.id} hoverable className="ailab-project-card" onClick={() => navigate(`/ai-lab/projects/${p.id}`)}>
      <div className="ailab-project-title">{p.title}</div>
      <Space wrap size={4} style={{ marginBottom: 8 }}>
        <Tag color="geekblue">{i18n.exists(`aiLab.task.${p.task_key}.title`) ? t(`aiLab.task.${p.task_key}.title`) : p.task_key}</Tag>
        <Tag>{t(`aiLab.participation.${p.participation_mode}`)}</Tag>
      </Space>
      <div className="ailab-project-stats">
        <span>{t('aiLab.card.samples', { count: p.summary?.sample_count ?? 0 })}</span>
        <span>{t('aiLab.card.models', { count: p.summary?.model_count ?? 0 })}</span>
        <span>{t('aiLab.card.holdout', { value: formatPercent(p.summary?.best_holdout_accuracy) })}</span>
        <span>{t('aiLab.card.gap', { value: formatPercent(p.summary?.generalization_gap) })}</span>
      </div>
      <Text type="secondary" className="ailab-muted">{new Date(p.updated_at).toLocaleString(i18n.language)}</Text>
    </Card>
  )

  const myTab = (
    <div>
      {projectsLoading ? <div className="ailab-loading"><Spin /></div> : (
        projects.length ? <div className="ailab-project-grid">{projects.map(projectCard)}</div>
          : <Empty description={t('aiLab.empty')}><Button type="primary" onClick={() => setOpen(true)}>{t('aiLab.newProject')}</Button></Empty>
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
        <div>
          <Title level={3} style={{ margin: 0 }}><ExperimentOutlined /> {t('aiLab.title')}</Title>
          <Paragraph type="secondary" style={{ margin: '4px 0 0' }}>{t('aiLab.subtitle')}</Paragraph>
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
                  <div className="ailab-task-group-title">{t(`aiLab.grade.${g}`)}</div>
                  <div className="ailab-task-radio">
                    {tasks.filter((task) => (task.grade_band || 'P') === g).map((task) => (
                      <Radio.Button key={task.key} value={task.key} className="ailab-task-option">
                        <div className="ailab-task-option-title">{taskTitle(task)}</div>
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
