/**
 * 学校批量导入弹窗
 *
 * 4 步导入向导：
 *   1. 下载模板（提示填写规则）
 *   2. 上传 Excel
 *   3. 预览校验（展示将创建多少学校、用户、跳过哪些行）
 *   4. 执行导入 + 结果展示（含失败/跳过行号、可下载创建报告）
 *
 * 创建日期：2026-05-09
 *
 * v1.1 异步化改造（2026-06-08）：
 *   配合后端"提交任务 → 后台异步执行 → 前端轮询进度"模式，解决大批量导入超时问题。
 *   - 点击"执行导入"后不再同步等待整个导入完成，而是：
 *       提交任务拿 taskId → 进入"导入中"进度态 → 轮询进度（实时进度条）→ 完成展示报告
 *   - 进度态期间锁死弹窗（不可关闭），避免用户中途关闭误以为失败
 *   - Steps 顶部仍为 4 格，进度态停留在"预览"步，主体切换为进度渲染，体验连贯
 *
 * v1.2（2026-06-08 同日）：
 *   进度条改用后端上报的 percent 字段（哈希阶段 0-40%、建用户阶段 40-100%，
 *   后端保证单调递增），不再由前端用 processed/total 计算——避免两阶段各自
 *   从 0 计数导致进度条"先涨后归零"。percent 缺失时回退旧算法兜底。
 */

import React, { useState } from 'react'
import {
  Modal,
  Steps,
  Button,
  Upload,
  Alert,
  Space,
  Typography,
  Table,
  Tag,
  Statistic,
  Row,
  Col,
  Divider,
  Card,
  Empty,
  Tooltip,
  Progress,
  Spin,
  message
} from 'antd'
import {
  DownloadOutlined,
  InboxOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
  FileExcelOutlined,
  CopyOutlined,
  RollbackOutlined,
  BankOutlined,
  TeamOutlined,
  UserAddOutlined,
  LoadingOutlined
} from '@ant-design/icons'
import useAdminStore from '../../../stores/adminStore'

const { Step } = Steps
const { Text, Title, Paragraph } = Typography
const { Dragger } = Upload

/**
 * 学校批量导入弹窗
 * @param {boolean} visible
 * @param {Function} onCancel
 * @param {Function} onSuccess - 导入成功后回调（用于刷新组列表）
 */
const SchoolImportModal = ({ visible, onCancel, onSuccess }) => {
  const {
    downloadSchoolImportTemplate,
    previewSchoolImport,
    executeSchoolImport,
    pollSchoolImportStatus
  } = useAdminStore()

  // 步骤状态：0=说明 1=上传 2=预览 3=结果
  const [currentStep, setCurrentStep] = useState(0)
  const [uploadedFile, setUploadedFile] = useState(null)
  const [previewResult, setPreviewResult] = useState(null)
  const [importResult, setImportResult] = useState(null)
  const [loading, setLoading] = useState(false)

  // v1.1 异步化：导入进度态
  const [importing, setImporting] = useState(false)        // 是否处于"导入中"进度态
  const [importProgress, setImportProgress] = useState({   // 实时进度
    phase: 'pending',   // pending | hashing | running | creating_users | completed | failed
    percent: 0,         // v1.2：后端上报的单调递增百分比
    processed: 0,
    total: 0,
    groups: 0
  })

  // 重置弹窗状态
  const resetState = () => {
    setCurrentStep(0)
    setUploadedFile(null)
    setPreviewResult(null)
    setImportResult(null)
    setLoading(false)
    setImporting(false)
    setImportProgress({ phase: 'pending', percent: 0, processed: 0, total: 0, groups: 0 })
  }

  // 关闭弹窗
  const handleCancel = () => {
    // v1.1：导入进度态期间禁止关闭，防止用户误以为失败
    if (importing) {
      message.warning('正在导入中，请等待完成...')
      return
    }
    if (loading) {
      message.warning('正在处理，请稍候...')
      return
    }
    resetState()
    onCancel()
  }

  // 完成（导入成功后关闭）
  const handleFinish = () => {
    resetState()
    if (importResult?.success) {
      onSuccess && onSuccess()
    }
    onCancel()
  }

  // ========== 步骤 0：下载模板 ==========
  const handleDownloadTemplate = async () => {
    try {
      setLoading(true)
      await downloadSchoolImportTemplate()
      message.success('模板已开始下载')
    } catch (error) {
      message.error('模板下载失败：' + (error.response?.data?.message || error.message))
    } finally {
      setLoading(false)
    }
  }

  // ========== 步骤 1：上传 ==========
  const beforeUpload = (file) => {
    const isExcel = /\.(xlsx|xls)$/i.test(file.name)
    if (!isExcel) {
      message.error('只能上传 .xlsx 或 .xls 格式的 Excel 文件')
      return Upload.LIST_IGNORE
    }
    const isLt5M = file.size / 1024 / 1024 < 5
    if (!isLt5M) {
      message.error('文件大小不能超过 5MB')
      return Upload.LIST_IGNORE
    }
    setUploadedFile(file)
    return false  // 阻止自动上传，由 handlePreview 手动调用 API
  }

  // ========== 步骤 2：预览 ==========
  const handlePreview = async () => {
    if (!uploadedFile) {
      message.warning('请先选择 Excel 文件')
      return
    }
    try {
      setLoading(true)
      const result = await previewSchoolImport(uploadedFile)
      setPreviewResult(result)
      setCurrentStep(2)
    } catch (error) {
      const msg = error.response?.data?.message || error.message || '预览失败'
      message.error('预览失败：' + msg)
    } finally {
      setLoading(false)
    }
  }

  // ========== 步骤 3：执行导入（v1.1 异步化）==========
  const handleExecute = async () => {
    if (!uploadedFile) {
      message.error('文件丢失，请重新上传')
      return
    }
    Modal.confirm({
      title: '确认执行批量导入？',
      content: (
        <div>
          <Paragraph>
            即将创建 <Text strong>{Object.keys(previewResult.school_stats).length}</Text> 所学校（用户组），
            导入 <Text strong type="success">{previewResult.will_create_count}</Text> 个用户，
            跳过 <Text strong type="warning">{previewResult.will_skip_count}</Text> 行。
          </Paragraph>
          <Paragraph type="secondary">
            导入后，所有用户的初始密码均为：<Text code>用户名 + 123456</Text>
          </Paragraph>
          <Paragraph type="secondary">
            大批量导入将在后台执行，过程中请勿关闭此窗口。
          </Paragraph>
        </div>
      ),
      okText: '确认导入',
      cancelText: '取消',
      onOk: async () => {
        try {
          // 进入进度态：初始化进度（total 先用预览的将创建数，后端会上报准确值）
          setImporting(true)
          setImportProgress({
            phase: 'pending',
            percent: 0,
            processed: 0,
            total: previewResult.will_create_count || 0,
            groups: 0
          })

          // 1) 提交任务，秒级拿到 taskId
          const taskId = await executeSchoolImport(uploadedFile)

          // 2) 轮询任务进度直到完成/失败
          const result = await pollSchoolImportStatus(taskId, {
            intervalMs: 2500,
            onProgress: (progress) => {
              setImportProgress(progress)
            }
          })

          // 3) 完成：保存结果并切到结果步
          setImportResult(result)
          setImporting(false)
          setCurrentStep(3)
          if (result.success) {
            message.success(result.message)
          }
        } catch (error) {
          // 失败：退出进度态，退回预览步，提示错误
          setImporting(false)
          const msg = error.response?.data?.message || error.message || '导入失败'
          message.error('导入失败：' + msg)
        }
      }
    })
  }

  // ========== 复制创建结果到剪贴板 ==========
  const handleCopyResult = () => {
    if (!importResult?.created_users?.length) return
    const lines = [
      '学校名称\t用户名\t密码\t姓名\t角色\t积分',
      ...importResult.created_users.map(u =>
        `${u.school_name}\t${u.username}\t${u.password}\t${u.real_name || ''}\t${u.role_text}\t${u.credits}`
      )
    ]
    navigator.clipboard.writeText(lines.join('\n'))
      .then(() => message.success(`已复制 ${importResult.created_users.length} 条用户信息`))
      .catch(() => message.error('复制失败'))
  }

  // ========== 导出创建报告（CSV）==========
  const handleExportReport = () => {
    if (!importResult?.created_users?.length) return
    const headers = ['学校名称', '用户名', '密码', '姓名', '角色', '积分', '已分配标签']
    const rows = importResult.created_users.map(u => [
      u.school_name,
      u.username,
      u.password,
      u.real_name || '',
      u.role_text,
      u.credits,
      (u.tags_assigned || []).join('|')
    ])
    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `批量导入结果_${new Date().toISOString().split('T')[0]}.csv`
    link.click()
    URL.revokeObjectURL(url)
    message.success('报告已导出')
  }

  // ========================================
  // 渲染：步骤 0 - 说明 + 下载模板
  // ========================================
  const renderStep0 = () => (
    <div>
      <Alert
        message="批量导入功能说明"
        description={
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>一次可导入多所学校的多个学生（每所学校自动创建一个用户组）</li>
            <li>支持普通用户和学校管理员两种角色（学校管理员可登录管理后台管理本组）</li>
            <li>年级和班级会自动转为该组的标签，便于后续筛选用户</li>
            <li>已存在的用户名将被跳过，导入完成后会显示详细报告</li>
            <li><Text strong>初始密码规则：用户名 + 123456</Text>（例如 zhangsan_pkz123456）</li>
            <li>同名学校自动追加 _2/_3 后缀创建新组（防止误合并不同学校）</li>
            <li>单次导入最多 5000 行</li>
          </ul>
        }
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Card style={{ textAlign: 'center', background: '#fafafa' }}>
        <Title level={5} style={{ marginBottom: 16 }}>
          <FileExcelOutlined style={{ color: '#52c41a', marginRight: 8 }} />
          第一步：下载导入模板
        </Title>
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          请使用最新模板填写数据，模板包含示例行和详细字段说明
        </Paragraph>
        <Button
          type="primary"
          size="large"
          icon={<DownloadOutlined />}
          loading={loading}
          onClick={handleDownloadTemplate}
        >
          下载 Excel 模板
        </Button>
      </Card>
    </div>
  )

  // ========================================
  // 渲染：步骤 1 - 上传文件
  // ========================================
  const renderStep1 = () => (
    <div>
      <Dragger
        name="file"
        accept=".xlsx,.xls"
        multiple={false}
        maxCount={1}
        beforeUpload={beforeUpload}
        onRemove={() => { setUploadedFile(null); return true }}
        fileList={uploadedFile ? [{ uid: '-1', name: uploadedFile.name, status: 'done' }] : []}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined style={{ color: '#1677ff' }} />
        </p>
        <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
        <p className="ant-upload-hint">
          仅支持单个 .xlsx 或 .xls 文件，大小不超过 5MB
        </p>
      </Dragger>

      {uploadedFile && (
        <Alert
          style={{ marginTop: 16 }}
          type="success"
          showIcon
          message={`已选择文件：${uploadedFile.name}（${(uploadedFile.size / 1024).toFixed(1)} KB）`}
        />
      )}
    </div>
  )

  // ========================================
  // 渲染：步骤 2 - 预览
  // ========================================
  const renderStep2 = () => {
    if (!previewResult) return <Empty />

    const schoolList = Object.entries(previewResult.school_stats).map(([name, stats], idx) => ({
      key: idx,
      school_name: name,
      ...stats
    }))

    const willSkipTotal = previewResult.will_skip_count
    const willCreateTotal = previewResult.will_create_count
    const hasInvalid = previewResult.invalid_rows.length > 0
    const hasDuplicate = previewResult.duplicated_in_file.length > 0
    const hasExisting = previewResult.existing_in_db.length > 0

    return (
      <div>
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="总行数"
                value={previewResult.total_rows}
                prefix={<FileExcelOutlined />}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="将创建学校"
                value={schoolList.length}
                prefix={<BankOutlined />}
                valueStyle={{ color: '#1677ff' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="将创建用户"
                value={willCreateTotal}
                prefix={<UserAddOutlined />}
                valueStyle={{ color: '#52c41a' }}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic
                title="将跳过"
                value={willSkipTotal + previewResult.invalid_rows.length}
                prefix={<WarningOutlined />}
                valueStyle={{ color: willSkipTotal + previewResult.invalid_rows.length > 0 ? '#faad14' : '#999' }}
              />
            </Card>
          </Col>
        </Row>

        {willCreateTotal > 0 ? (
          <Alert
            type="success"
            showIcon
            message="校验通过，可以执行导入"
            description={`将为 ${schoolList.length} 所学校创建用户组，并导入 ${willCreateTotal} 个用户。`}
            style={{ marginBottom: 16 }}
          />
        ) : (
          <Alert
            type="error"
            showIcon
            message="无法导入：所有数据行都将被跳过或校验失败"
            style={{ marginBottom: 16 }}
          />
        )}

        <Card size="small" title={`将创建的学校分布（共 ${schoolList.length} 所）`} style={{ marginBottom: 16 }}>
          <Table
            size="small"
            dataSource={schoolList}
            pagination={{ pageSize: 5, simple: true }}
            columns={[
              { title: '学校名称', dataIndex: 'school_name', ellipsis: true },
              { title: '学生数', dataIndex: 'total', width: 80, align: 'right' },
              { title: '管理员', dataIndex: 'admin', width: 80, align: 'right',
                render: (v) => v > 0 ? <Tag color="purple">{v}</Tag> : '-' },
              { title: '普通用户', dataIndex: 'user', width: 90, align: 'right',
                render: (v) => v > 0 ? <Tag color="blue">{v}</Tag> : '-' }
            ]}
          />
        </Card>

        {hasInvalid && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            message={`${previewResult.invalid_rows.length} 行数据格式错误（将被跳过）`}
            description={
              <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: 12 }}>
                {previewResult.invalid_rows.slice(0, 20).map((r, i) => (
                  <div key={i}>第 {r.row_number} 行：{r.errors.join('；')}</div>
                ))}
                {previewResult.invalid_rows.length > 20 && (
                  <div>...还有 {previewResult.invalid_rows.length - 20} 行错误未显示</div>
                )}
              </div>
            }
          />
        )}

        {hasDuplicate && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={`${previewResult.duplicated_in_file.length} 行用户名在文件内重复（将保留首次出现的行）`}
            description={
              <div style={{ maxHeight: 100, overflowY: 'auto', fontSize: 12 }}>
                {previewResult.duplicated_in_file.slice(0, 10).map((r, i) => (
                  <div key={i}>第 {r.row_number} 行 "{r.username}" 与第 {r.first_seen_at_row} 行重复</div>
                ))}
              </div>
            }
          />
        )}

        {hasExisting && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message={`${previewResult.existing_in_db.length} 行用户名已被系统中的用户使用（将被跳过）`}
            description={
              <div style={{ maxHeight: 100, overflowY: 'auto', fontSize: 12 }}>
                {previewResult.existing_in_db.slice(0, 10).map((r, i) => (
                  <div key={i}>第 {r.row_number} 行 "{r.username}" 已存在</div>
                ))}
                {previewResult.existing_in_db.length > 10 && (
                  <div>...还有 {previewResult.existing_in_db.length - 10} 行未显示</div>
                )}
              </div>
            }
          />
        )}
      </div>
    )
  }

  // ========================================
  // 渲染：导入进度态（v1.1 异步化新增，v1.2 进度条用后端 percent）
  // 在点击"执行导入"后展示，停留在"预览"步，主体替换为进度
  // ========================================
  const renderImporting = () => {
    const { phase, percent, processed, total, groups } = importProgress

    // 阶段中文文案
    const phaseTextMap = {
      pending: '正在准备导入任务...',
      hashing: '正在准备用户账号（加密密码）...',
      running: '正在初始化导入...',
      creating_users: '正在创建用户与分配标签...',
      completed: '导入完成',
      failed: '导入失败'
    }
    const phaseText = phaseTextMap[phase] || '正在处理...'

    // v1.2：优先用后端上报的 percent（单调递增），缺失时回退按 processed/total 计算
    const displayPercent = Number.isFinite(percent) && percent > 0
      ? Math.min(99, percent)
      : (total > 0 ? Math.min(99, Math.floor((processed / total) * 100)) : 0)

    return (
      <div style={{ padding: '32px 24px', textAlign: 'center' }}>
        <Spin
          indicator={<LoadingOutlined style={{ fontSize: 36, color: '#1677ff' }} spin />}
        />

        <Title level={5} style={{ marginTop: 24, marginBottom: 8 }}>
          {phaseText}
        </Title>

        <Paragraph type="secondary" style={{ marginBottom: 24 }}>
          大批量导入将在后台执行，请耐心等待，期间请勿关闭此窗口
        </Paragraph>

        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <Progress
            percent={displayPercent}
            status={phase === 'failed' ? 'exception' : 'active'}
            strokeColor={{ from: '#1677ff', to: '#52c41a' }}
          />

          <Row gutter={16} style={{ marginTop: 24 }}>
            <Col span={8}>
              <Statistic
                title="已处理用户"
                value={processed}
                valueStyle={{ color: '#1677ff', fontSize: 22 }}
              />
            </Col>
            <Col span={8}>
              <Statistic
                title="用户总数"
                value={total}
                valueStyle={{ fontSize: 22 }}
              />
            </Col>
            <Col span={8}>
              <Statistic
                title="已创建学校"
                value={groups}
                prefix={<BankOutlined />}
                valueStyle={{ color: '#52c41a', fontSize: 22 }}
              />
            </Col>
          </Row>
        </div>
      </div>
    )
  }

  // ========================================
  // 渲染：步骤 3 - 结果
  // ========================================
  const renderStep3 = () => {
    if (!importResult) return <Empty />

    const { summary, created_groups, created_users, skipped_rows, invalid_rows, failed_rows } = importResult

    return (
      <div>
        <Alert
          type={importResult.success ? 'success' : 'warning'}
          showIcon
          icon={importResult.success ? <CheckCircleOutlined /> : <WarningOutlined />}
          message={importResult.message}
          style={{ marginBottom: 16 }}
        />

        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={6}>
            <Card size="small">
              <Statistic title="创建学校" value={summary.groups_created || 0}
                prefix={<BankOutlined />} valueStyle={{ color: '#1677ff' }} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic title="创建用户" value={summary.success}
                prefix={<UserAddOutlined />} valueStyle={{ color: '#52c41a' }} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic title="跳过" value={summary.skipped}
                valueStyle={{ color: summary.skipped > 0 ? '#faad14' : '#999' }} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic title="失败" value={summary.failed}
                valueStyle={{ color: summary.failed > 0 ? '#ff4d4f' : '#999' }} />
            </Card>
          </Col>
        </Row>

        {created_groups?.length > 0 && (
          <Card size="small" title="已创建的学校（用户组）" style={{ marginBottom: 12 }}>
            <Table
              size="small"
              dataSource={created_groups.map((g, i) => ({ key: i, ...g }))}
              pagination={{ pageSize: 5, simple: true }}
              columns={[
                { title: '学校名称', dataIndex: 'school_name', ellipsis: true },
                { title: '组名（可能含后缀）', dataIndex: 'group_name', ellipsis: true,
                  render: (v) => <Tag color="blue">{v}</Tag> },
                { title: '导入学生数', dataIndex: 'students_imported', width: 100, align: 'right' },
                { title: '初始积分池', dataIndex: 'credits_pool', width: 110, align: 'right',
                  render: (v) => v.toLocaleString() }
              ]}
            />
          </Card>
        )}

        {created_users?.length > 0 && (
          <Card
            size="small"
            title={`已创建的用户（${created_users.length} 个）`}
            extra={
              <Space>
                <Tooltip title="复制用户名+密码到剪贴板">
                  <Button size="small" icon={<CopyOutlined />} onClick={handleCopyResult}>
                    复制
                  </Button>
                </Tooltip>
                <Button size="small" icon={<DownloadOutlined />} onClick={handleExportReport}>
                  导出 CSV
                </Button>
              </Space>
            }
            style={{ marginBottom: 12 }}
          >
            <Table
              size="small"
              dataSource={created_users.map((u, i) => ({ key: i, ...u }))}
              pagination={{ pageSize: 5 }}
              scroll={{ x: 800 }}
              columns={[
                { title: '行号', dataIndex: 'row_number', width: 60 },
                { title: '学校', dataIndex: 'school_name', ellipsis: true, width: 140 },
                { title: '用户名', dataIndex: 'username', width: 140 },
                { title: '初始密码', dataIndex: 'password', width: 160,
                  render: (v) => <Text copyable={{ text: v }}>{v}</Text> },
                { title: '姓名', dataIndex: 'real_name', width: 80 },
                { title: '角色', dataIndex: 'role_text', width: 100,
                  render: (v) => <Tag color={v === '学校管理员' ? 'purple' : 'blue'}>{v}</Tag> },
                { title: '积分', dataIndex: 'credits', width: 80, align: 'right' }
              ]}
            />
          </Card>
        )}

        {skipped_rows?.length > 0 && (
          <Alert
            type="warning"
            showIcon
            message={`${skipped_rows.length} 行被跳过`}
            description={
              <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: 12 }}>
                {skipped_rows.slice(0, 20).map((r, i) => (
                  <div key={i}>第 {r.row_number} 行 "{r.username}"：{r.reason}</div>
                ))}
                {skipped_rows.length > 20 && <div>...还有 {skipped_rows.length - 20} 行未显示</div>}
              </div>
            }
            style={{ marginBottom: 12 }}
          />
        )}

        {(invalid_rows?.length > 0 || failed_rows?.length > 0) && (
          <Alert
            type="error"
            showIcon
            message={`${(invalid_rows?.length || 0) + (failed_rows?.length || 0)} 行失败`}
            description={
              <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: 12 }}>
                {(invalid_rows || []).map((r, i) => (
                  <div key={`inv-${i}`}>第 {r.row_number} 行（格式错误）：{r.errors.join('；')}</div>
                ))}
                {(failed_rows || []).map((r, i) => (
                  <div key={`fail-${i}`}>第 {r.row_number} 行 "{r.username}"：{r.reason}</div>
                ))}
              </div>
            }
          />
        )}
      </div>
    )
  }

  // ========================================
  // 步骤底部按钮
  // ========================================
  const renderFooter = () => {
    // v1.1：导入进度态期间，footer 只显示禁用的"导入中"按钮
    if (importing) {
      return (
        <Button type="primary" loading disabled>
          导入中，请勿关闭...
        </Button>
      )
    }
    if (currentStep === 0) {
      return (
        <Space>
          <Button onClick={handleCancel}>取消</Button>
          <Button type="primary" onClick={() => setCurrentStep(1)}>
            下一步：上传文件
          </Button>
        </Space>
      )
    }
    if (currentStep === 1) {
      return (
        <Space>
          <Button icon={<RollbackOutlined />} onClick={() => setCurrentStep(0)}>上一步</Button>
          <Button onClick={handleCancel}>取消</Button>
          <Button
            type="primary"
            disabled={!uploadedFile}
            loading={loading}
            onClick={handlePreview}
          >
            下一步：预览校验
          </Button>
        </Space>
      )
    }
    if (currentStep === 2) {
      return (
        <Space>
          <Button icon={<RollbackOutlined />} onClick={() => setCurrentStep(1)}>重新上传</Button>
          <Button onClick={handleCancel}>取消</Button>
          <Button
            type="primary"
            disabled={!previewResult || previewResult.will_create_count === 0}
            loading={loading}
            onClick={handleExecute}
          >
            执行导入
          </Button>
        </Space>
      )
    }
    // step 3
    return (
      <Button type="primary" onClick={handleFinish}>完成</Button>
    )
  }

  return (
    <Modal
      title={
        <Space>
          <BankOutlined />
          <span>批量导入学校</span>
        </Space>
      }
      open={visible}
      onCancel={handleCancel}
      width={920}
      maskClosable={false}
      keyboard={!importing}
      destroyOnClose
      footer={renderFooter()}
    >
      <Steps current={currentStep} size="small" style={{ marginBottom: 24 }}>
        <Step title="说明" description="下载模板" />
        <Step title="上传" description="选择 Excel" />
        <Step title="预览" description="校验数据" />
        <Step title="完成" description="导入结果" />
      </Steps>

      <Divider style={{ margin: '0 0 16px 0' }} />

      <div style={{ minHeight: 360 }}>
        {/* v1.1：进度态优先渲染，覆盖在"预览"步之上 */}
        {importing
          ? renderImporting()
          : (
            <>
              {currentStep === 0 && renderStep0()}
              {currentStep === 1 && renderStep1()}
              {currentStep === 2 && renderStep2()}
              {currentStep === 3 && renderStep3()}
            </>
          )
        }
      </div>
    </Modal>
  )
}

export default SchoolImportModal
