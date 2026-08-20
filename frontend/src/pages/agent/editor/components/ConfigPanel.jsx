/**
 * 配置面板 - 显示选中节点的配置选项 v3.2
 *
 * v3.0 - 知识库选择改为手动点击添加，去掉自动推荐高亮
 * v3.1 - 默认max_tokens从2000改为5000
 *       - 新建节点自动填充默认模型逻辑保留（配合WorkflowEditor v2.1双重保障）
 * v3.2 - 国际化改造：
 *   1) 接入 useTranslation，将约 55 处硬编码中文替换为 agent.config.* 翻译键；
 *   2) 分类数量上限抽为 MAX_CATEGORIES 常量，不再把 100 散落在多处；
 *   3) 新增分类的默认名称改用 agent.config 下的插值键按当前语言生成，
 *      避免把中文"分类N"写入数据库（与 WorkflowEditor 的处理保持一致）；
 *   4) 积分文案原为 JS 模板字符串拼接（`${credits} 积分/次`），
 *      改为 creditsPerChat 插值键，中英语序均可正确表达；
 *   5) 知识库已选汇总、Token 说明等整句文案改为完整句子插值，
 *      不用多段中文拼接（英文语序与中文不同，拼接必然出错）。
 */

import React, { useEffect, useState, useMemo } from 'react'
import {
  Form, Input, Select, InputNumber, Empty, Spin, Slider,
  Button, Space, Tag, List, Typography, message
} from 'antd'
import {
  SettingOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  UserOutlined,
  TeamOutlined,
  GlobalOutlined,
  DeleteOutlined,
  PlusOutlined,
  BranchesOutlined,
  TagOutlined,
  SyncOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import useAgentStore from '../../../../stores/agentStore'
import './ConfigPanel.less'

const { Text } = Typography

/** 分类节点支持的最大分类数量 */
const MAX_CATEGORIES = 100

const ConfigPanel = ({
  selectedNode,
  onUpdateConfig,
  onSave,
  saving = false,
  hasUnsavedChanges = false,
  inDrawer = false
}) => {
  const { t } = useTranslation()
  const [form] = Form.useForm()

  const {
    availableModels, modelsLoading, fetchAvailableModels,
    wikiItems, wikiItemsLoading, fetchWikiItems
  } = useAgentStore()

  const [selectedWikis, setSelectedWikis] = useState([])
  const [categories, setCategories] = useState([])
  /* 知识库搜索关键词状态（用于搜索过滤） */
  const [wikiSearchValue, setWikiSearchValue] = useState('')

  /* 加载可用模型列表 */
  useEffect(() => {
    if (availableModels.length === 0) fetchAvailableModels()
  }, [])

  /* 节点选中时同步表单数据 */
  useEffect(() => {
    if (selectedNode) {
      const config = selectedNode.data?.config || {}
      form.setFieldsValue(config)

      /* 知识库节点：恢复已选知识库 */
      if (selectedNode.type === 'knowledge' && config.wiki_ids) {
        if (config.selected_wikis && config.selected_wikis.length > 0) {
          setSelectedWikis(config.selected_wikis)
        } else {
          const selected = (config.wiki_ids || []).map(id => {
            const item = wikiItems.find(w => w.id === id)
            /* 知识库信息缺失时使用占位名称，避免界面显示空白 */
            return item || {
              id,
              title: t('agent.config.unknownWiki', { id }),
              tokens_display: t('agent.config.unknownTokens'),
              tokens: 0
            }
          }).filter(Boolean)
          setSelectedWikis(selected)
        }
      } else {
        setSelectedWikis([])
      }

      /* 分类节点：恢复分类列表 */
      if (selectedNode.type === 'classifier' && config.categories) {
        setCategories(config.categories || [])
      } else {
        setCategories([])
      }
    } else {
      form.resetFields()
      setSelectedWikis([])
      setCategories([])
    }
  }, [selectedNode, form, wikiItems, t])

  /**
   * 当模型列表加载完成后，自动为LLM/分类节点填充默认模型
   * （双重保障：WorkflowEditor创建时填充 + ConfigPanel打开时补充）
   */
  useEffect(() => {
    if (!selectedNode || availableModels.length === 0) return

    const needsDefaultModel = selectedNode.type === 'llm' || selectedNode.type === 'classifier'
    const currentModel = selectedNode.data?.config?.model

    if (needsDefaultModel && !currentModel) {
      const defaultModelObj = availableModels[0]
      if (defaultModelObj?.name) {
        form.setFieldsValue({ model: defaultModelObj.name })
        const allValues = form.getFieldsValue()
        allValues.model = defaultModelObj.name
        allValues.model_display_name = defaultModelObj.display_name || defaultModelObj.name
        if (selectedNode.type === 'classifier') {
          allValues.categories = categories
        }
        onUpdateConfig(selectedNode.id, allValues)
      }
    }
  }, [selectedNode, availableModels])

  /* 知识库节点自动加载知识库列表 */
  useEffect(() => {
    if (selectedNode?.type === 'knowledge' && wikiItems.length === 0) fetchWikiItems()
  }, [selectedNode?.type])

  /**
   * 构建知识库元数据（仅保留下游节点需要的字段，避免存储冗余）
   */
  const buildWikiMetadata = (wikis) => wikis.map(w => ({
    id: w.id,
    title: w.title,
    scope: w.scope,
    tokens: w.tokens || 0,
    tokens_display: w.tokens_display || t('agent.config.unknownTokens')
  }))

  /**
   * 表单值变化回调 - 实时同步到画布节点
   * 当模型选择变化时，自动查找并写入 model_display_name
   */
  const handleValuesChange = (changedValues, allValues) => {
    if (selectedNode) {
      /* 模型变更时同步写入 display_name，供画布节点直接展示 */
      if (changedValues.model !== undefined) {
        const selectedModelObj = availableModels.find(m => m.name === changedValues.model)
        if (selectedModelObj) {
          allValues.model_display_name = selectedModelObj.display_name || selectedModelObj.name
        }
      }

      if (selectedNode.type === 'knowledge') {
        allValues.wiki_ids = selectedWikis.map(w => w.id)
        allValues.selected_wikis = buildWikiMetadata(selectedWikis)
      }
      if (selectedNode.type === 'classifier') {
        allValues.categories = categories
      }
      onUpdateConfig(selectedNode.id, allValues)
    }
  }

  /**
   * 手动添加知识库 - 用户必须明确点击选项才添加
   */
  const handleAddWiki = (wikiId) => {
    const wiki = wikiItems.find(w => w.id === wikiId)
    if (wiki && !selectedWikis.find(w => w.id === wikiId)) {
      const newSelected = [...selectedWikis, wiki]
      setSelectedWikis(newSelected)
      const currentValues = form.getFieldsValue()
      currentValues.wiki_ids = newSelected.map(w => w.id)
      currentValues.selected_wikis = buildWikiMetadata(newSelected)
      onUpdateConfig(selectedNode.id, currentValues)
    }
    /* 选择后清空搜索框，恢复完整列表 */
    setWikiSearchValue('')
  }

  /** 移除已选知识库 */
  const handleRemoveWiki = (wikiId) => {
    const newSelected = selectedWikis.filter(w => w.id !== wikiId)
    setSelectedWikis(newSelected)
    const currentValues = form.getFieldsValue()
    currentValues.wiki_ids = newSelected.map(w => w.id)
    currentValues.selected_wikis = buildWikiMetadata(newSelected)
    onUpdateConfig(selectedNode.id, currentValues)
  }

  /**
   * 添加分类
   * 默认分类名按当前界面语言生成，避免把中文写入数据库
   */
  const handleAddCategory = () => {
    if (categories.length >= MAX_CATEGORIES) {
      message.warning(t('agent.config.categoryMaxWarning', { max: MAX_CATEGORIES }))
      return
    }
    const newCategory = {
      id: `cat-${Date.now()}`,
      name: t('agent.editor.categoryDefault', { index: categories.length + 1 }),
      description: ''
    }
    const newCategories = [...categories, newCategory]
    setCategories(newCategories)
    const currentValues = form.getFieldsValue()
    currentValues.categories = newCategories
    onUpdateConfig(selectedNode.id, currentValues)
  }

  /** 更新指定分类的某个字段 */
  const handleUpdateCategory = (index, field, value) => {
    const newCategories = [...categories]
    newCategories[index] = { ...newCategories[index], [field]: value }
    setCategories(newCategories)
    const currentValues = form.getFieldsValue()
    currentValues.categories = newCategories
    onUpdateConfig(selectedNode.id, currentValues)
  }

  /** 删除指定分类 */
  const handleRemoveCategory = (index) => {
    const newCategories = categories.filter((_, i) => i !== index)
    setCategories(newCategories)
    const currentValues = form.getFieldsValue()
    currentValues.categories = newCategories
    onUpdateConfig(selectedNode.id, currentValues)
  }

  /* 计算已选知识库的总 Token 数 */
  const totalTokens = selectedWikis.reduce((sum, w) => sum + (w.tokens || 0), 0)

  /**
   * 格式化 Token 数显示（超过1000转为K单位）
   * 注意：参数名不使用 t，避免与 i18n 的翻译函数 t 命名冲突
   */
  const formatTotalTokens = (tokens) => {
    if (tokens === 0) return '0'
    if (tokens < 1000) return `${tokens}`
    return `${(tokens / 1000).toFixed(1)}K`
  }

  /* 知识库范围图标映射 */
  const scopeIcons = {
    personal: <UserOutlined style={{ color: '#1890ff' }} />,
    team: <TeamOutlined style={{ color: '#52c41a' }} />,
    global: <GlobalOutlined style={{ color: '#fa8c16' }} />
  }

  /* 节点类型对应的主题色 */
  const nodeThemeColors = {
    start: '#52c41a', llm: '#1890ff', end: '#ff4d4f',
    knowledge: '#722ed1', classifier: '#d48806'
  }
  const themeColor = nodeThemeColors[selectedNode?.type] || '#1890ff'

  /* 空状态：未选中任何节点 */
  if (!selectedNode) {
    return (
      <div className="cp-empty">
        <Empty
          description={t('agent.editor.selectNode')}
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </div>
    )
  }

  /** 顶部状态栏：提示配置是否已保存 */
  const renderStatusBar = () => {
    if (!inDrawer) return null
    return (
      <div className="cp-save-bar">
        <span className="cp-save-status">
          {hasUnsavedChanges ? (
            <span className="cp-unsaved">
              <SyncOutlined spin /> {t('agent.config.unsavedHint')}
            </span>
          ) : (
            <span className="cp-saved">
              <CheckCircleOutlined /> {t('agent.config.savedHint')}
            </span>
          )}
        </span>
      </div>
    )
  }

  /**
   * 知识库配置区域
   */
  const renderKnowledgeConfig = () => {
    /* 过滤掉已选的，生成可选下拉列表 */
    const availableWikiOptions = wikiItems
      .filter(w => !selectedWikis.find(s => s.id === w.id))
      .map(wiki => ({
        value: wiki.id,
        label: (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{wiki.title}</span>
            <Space size={4}>
              {wiki.rag_enabled && wiki.index_status === 'completed' && (
                <Tag color="purple" style={{ margin: 0, fontSize: 11 }}>
                  <ThunderboltOutlined /> RAG
                </Tag>
              )}
              <Tag color="default" style={{ margin: 0, fontSize: 11 }}>
                {wiki.tokens_display} tokens
              </Tag>
            </Space>
          </div>
        ),
        /* 用于搜索过滤的纯文本 */
        searchText: wiki.title
      }))

    return (
      <>
        <div className="cp-section-header">
          <DatabaseOutlined style={{ color: '#722ed1' }} /> {t('agent.config.knowledgeSection')}
        </div>

        <Form.Item label={t('agent.config.dataSource')} name="source" initialValue="wiki">
          <Select>
            <Select.Option value="wiki">
              <Space>
                <FileTextOutlined />
                <span>{t('agent.config.dataSourceWiki')}</span>
              </Space>
            </Select.Option>
          </Select>
        </Form.Item>

        <Form.Item
          label={t('agent.config.loadMode')}
          name="mode"
          initialValue="direct"
          tooltip={t('agent.config.loadModeTip')}
        >
          <Select>
            <Select.Option value="rag">{t('agent.config.loadModeRag')}</Select.Option>
            <Select.Option value="direct">{t('agent.config.loadModeDirect')}</Select.Option>
          </Select>
        </Form.Item>

        <Form.Item
          label={t('agent.config.selectWiki')}
          tooltip={t('agent.config.selectWikiTip')}
        >
          {wikiItemsLoading ? <Spin size="small" /> : (
            <Select
              placeholder={t('agent.config.selectWikiPlaceholder')}
              showSearch
              value={undefined}
              onChange={handleAddWiki}
              style={{ width: '100%' }}
              options={availableWikiOptions}
              filterOption={(input, option) => {
                return (option?.searchText || '').toLowerCase().includes(input.toLowerCase())
              }}
              onBlur={() => setWikiSearchValue('')}
              searchValue={wikiSearchValue}
              onSearch={setWikiSearchValue}
              labelInValue={false}
              notFoundContent={
                wikiItems.length === 0
                  ? t('agent.config.noWikiAvailable')
                  : t('agent.config.noWikiMatch')
              }
            />
          )}
        </Form.Item>

        {selectedWikis.length > 0 && (
          <div className="cp-wiki-list">
            <div className="cp-wiki-list-header">
              <Text type="secondary" style={{ fontSize: '12px' }}>
                {t('agent.config.wikiSelectedSummary', {
                  count: selectedWikis.length,
                  tokens: formatTotalTokens(totalTokens)
                })}
              </Text>
            </div>
            <List
              size="small"
              bordered
              dataSource={selectedWikis}
              className="cp-wiki-items"
              renderItem={(wiki) => (
                <List.Item
                  style={{ padding: '8px 12px' }}
                  actions={[
                    <Button
                      type="text"
                      danger
                      size="small"
                      key="rm"
                      icon={<DeleteOutlined />}
                      onClick={() => handleRemoveWiki(wiki.id)}
                    />
                  ]}
                >
                  <List.Item.Meta
                    avatar={scopeIcons[wiki.scope] || <FileTextOutlined />}
                    title={<span style={{ fontSize: '13px' }}>{wiki.title}</span>}
                    description={
                      <Space size={4}>
                        <Tag color="processing" style={{ fontSize: '11px' }}>
                          {wiki.tokens_display} tokens
                        </Tag>
                        {wiki.rag_enabled && wiki.index_status === 'completed' && (
                          <Tag color="purple" style={{ fontSize: '11px' }}>
                            <ThunderboltOutlined /> RAG
                          </Tag>
                        )}
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
            <div className="cp-info-card purple">
              <InfoCircleOutlined />{' '}
              {t('agent.config.wikiTokensNote', { tokens: formatTotalTokens(totalTokens) })}
            </div>
          </div>
        )}
      </>
    )
  }

  /** 分类节点配置区域 */
  const renderClassifierConfig = () => (
    <>
      <div className="cp-section-header">
        <BranchesOutlined style={{ color: '#d48806' }} /> {t('agent.config.classifierSection')}
      </div>

      <Form.Item
        label={t('agent.config.model')}
        name="model"
        rules={[{ required: true, message: t('agent.config.modelRequired') }]}
        tooltip={t('agent.config.classifierModelTip')}
      >
        {modelsLoading ? <Spin size="small" /> : (
          <Select
            placeholder={t('agent.config.modelPlaceholder')}
            showSearch
            optionFilterProp="children"
          >
            {availableModels.map((m) => (
              <Select.Option key={m.name} value={m.name}>{m.display_name}</Select.Option>
            ))}
          </Select>
        )}
      </Form.Item>

      <Form.Item
        label={t('agent.config.backgroundKnowledge')}
        name="background_knowledge"
        tooltip={t('agent.config.backgroundKnowledgeTip')}
      >
        <Input.TextArea rows={3} placeholder={t('agent.config.backgroundKnowledgePlaceholder')} />
      </Form.Item>

      <Form.Item
        label={t('agent.config.chatHistory')}
        name="history_turns"
        initialValue={6}
        tooltip={t('agent.config.chatHistoryTip')}
      >
        <InputNumber
          min={0}
          max={20}
          style={{ width: '100%' }}
          addonAfter={t('agent.config.roundUnit')}
        />
      </Form.Item>

      <div className="cp-section-header">
        <TagOutlined style={{ color: '#d48806' }} />{' '}
        {t('agent.config.categoryList', { count: categories.length, max: MAX_CATEGORIES })}
      </div>

      <div className="cp-category-list">
        {categories.map((cat, index) => (
          <div key={cat.id} className="cp-category-item">
            <div className="cp-category-item-header">
              <Tag color="orange">{index + 1}</Tag>
              <Input
                placeholder={t('agent.config.categoryNamePlaceholder')}
                value={cat.name}
                onChange={(e) => handleUpdateCategory(index, 'name', e.target.value)}
                style={{ flex: 1 }}
              />
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={() => handleRemoveCategory(index)}
              />
            </div>
            <Input.TextArea
              placeholder={t('agent.config.categoryDescPlaceholder')}
              value={cat.description}
              onChange={(e) => handleUpdateCategory(index, 'description', e.target.value)}
              rows={2}
              className="cp-category-desc"
            />
          </div>
        ))}

        <Button
          type="dashed"
          block
          icon={<PlusOutlined />}
          onClick={handleAddCategory}
          disabled={categories.length >= MAX_CATEGORIES}
          className="cp-add-category-btn"
        >
          {t('agent.config.addCategory')}
        </Button>

        {categories.length === 0 && (
          <div className="cp-info-card amber">
            <InfoCircleOutlined /> {t('agent.config.categoryEmptyHint')}
          </div>
        )}
      </div>
    </>
  )

  /** 主配置表单 */
  const renderConfigForm = () => (
    <Form
      form={form}
      layout="vertical"
      onValuesChange={handleValuesChange}
      size="middle"
      className="cp-form"
    >
      <Form.Item
        label={t('agent.config.nodeName')}
        name="label"
        initialValue={selectedNode.data?.label}
      >
        <Input placeholder={t('agent.config.nodeNamePlaceholder')} />
      </Form.Item>

      {/* LLM节点配置 */}
      {selectedNode.type === 'llm' && (
        <>
          <div className="cp-section-header">
            <SettingOutlined style={{ color: '#1890ff' }} /> {t('agent.config.aiSection')}
          </div>

          <Form.Item
            label={t('agent.config.systemPrompt')}
            name="system_prompt"
            tooltip={t('agent.config.systemPromptTip')}
          >
            <Input.TextArea rows={4} placeholder={t('agent.config.systemPromptPlaceholder')} />
          </Form.Item>

          <Form.Item
            label={t('agent.config.model')}
            name="model"
            rules={[{ required: true, message: t('agent.config.modelRequired') }]}
          >
            {modelsLoading ? <Spin size="small" /> : (
              <Select
                placeholder={t('agent.config.modelPlaceholder')}
                showSearch
                optionFilterProp="children"
              >
                {availableModels.map((m) => (
                  <Select.Option key={m.name} value={m.name}>
                    {m.display_name} (
                    {m.credits_display ||
                      t('agent.config.creditsPerChat', { credits: m.credits_per_chat })}
                    )
                  </Select.Option>
                ))}
              </Select>
            )}
          </Form.Item>

          <Form.Item
            label={t('agent.config.historyTurns')}
            name="history_turns"
            initialValue={10}
            tooltip={t('agent.config.historyTurnsTip')}
          >
            <Slider
              min={0}
              max={100}
              marks={{ 0: '0', 10: '10', 50: '50', 100: '100' }}
              tooltip={{ formatter: (v) => t('agent.config.turnUnit', { count: v }) }}
            />
          </Form.Item>

          <Form.Item
            label={t('agent.config.temperature')}
            name="temperature"
            initialValue={0.7}
            tooltip={t('agent.config.temperatureTip')}
          >
            <InputNumber min={0} max={2} step={0.1} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            label={t('agent.config.maxTokens')}
            name="max_tokens"
            initialValue={5000}
            tooltip={t('agent.config.maxTokensTip')}
          >
            <InputNumber min={100} max={100000} style={{ width: '100%' }} />
          </Form.Item>
        </>
      )}

      {/* 开始节点配置 */}
      {selectedNode.type === 'start' && (
        <>
          <div className="cp-section-header">
            <InfoCircleOutlined style={{ color: '#52c41a' }} /> {t('agent.config.startSection')}
          </div>
          <Form.Item
            label={t('agent.config.welcomeMessage')}
            name="welcome_message"
            tooltip={t('agent.config.welcomeMessageTip')}
          >
            <Input.TextArea rows={3} placeholder={t('agent.config.welcomeMessagePlaceholder')} />
          </Form.Item>
          <Form.Item
            label={t('agent.config.inputSchema')}
            name="input_schema"
            tooltip={t('agent.config.inputSchemaTip')}
          >
            <Input.TextArea rows={3} placeholder='{"param1": "value1"}' />
          </Form.Item>
        </>
      )}

      {/* 结束节点配置 */}
      {selectedNode.type === 'end' && (
        <>
          <div className="cp-section-header">
            <InfoCircleOutlined style={{ color: '#ff4d4f' }} /> {t('agent.config.endSection')}
          </div>
          <Form.Item
            label={t('agent.config.outputMapping')}
            name="output_mapping"
            tooltip={t('agent.config.outputMappingTip')}
          >
            <Input.TextArea rows={3} placeholder="result" />
          </Form.Item>
        </>
      )}

      {selectedNode.type === 'knowledge' && renderKnowledgeConfig()}
      {selectedNode.type === 'classifier' && renderClassifierConfig()}
    </Form>
  )

  /** 节点基础信息卡片 */
  const renderNodeInfo = () => (
    <div className="cp-node-info" style={{ borderLeftColor: themeColor }}>
      <div className="cp-node-info-item">
        <span className="cp-node-info-label">{t('agent.config.nodeId')}</span>
        <span className="cp-node-info-value">{selectedNode.id}</span>
      </div>
      <div className="cp-node-info-item">
        <span className="cp-node-info-label">{t('agent.config.nodeType')}</span>
        <Tag color={themeColor} style={{ margin: 0 }}>{selectedNode.type}</Tag>
      </div>
    </div>
  )

  if (inDrawer) {
    return (
      <div className="cp-content">
        {renderStatusBar()}
        {renderConfigForm()}
        {renderNodeInfo()}
      </div>
    )
  }

  return (
    <div className="workflow-editor-config-panel">
      {renderConfigForm()}
      {renderNodeInfo()}
    </div>
  )
}

export default ConfigPanel
