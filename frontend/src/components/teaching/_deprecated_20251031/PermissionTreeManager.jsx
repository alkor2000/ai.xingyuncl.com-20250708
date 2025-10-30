/**
 * 教学模块权限管理器（三级权限版）
 * 
 * 版本更新 v2.0.0 (2025-10-31):
 * ✅ 三级权限体系：
 *    - view_lesson（查看课程）- 学生权限
 *    - view_plan（查看教案）- 教师权限
 *    - edit（编辑）- 创建者/管理员权限
 * ✅ 级联选择逻辑（自动授予下级权限，自动撤销上级权限）
 * ✅ 表格3列显示（查看课程 | 查看教案 | 编辑）
 * ✅ 统计数据增强
 * ✅ 批量操作支持三级
 * 
 * 原有功能保留：
 * ✅ 搜索和筛选
 * ✅ 分页处理
 * ✅ 权限继承可视化
 * ✅ 权限预览
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Card,
  Table,
  Button,
  Space,
  Tag,
  Switch,
  Input,
  Select,
  Drawer,
  Tree,
  Badge,
  Tooltip,
  message,
  Spin,
  Empty,
  Alert,
  Checkbox,
  Divider,
  Row,
  Col,
  Statistic,
  Modal
} from 'antd';
import {
  SearchOutlined,
  TeamOutlined,
  TagOutlined,
  UserOutlined,
  CheckCircleOutlined,
  MinusCircleOutlined,
  LockOutlined,
  UnlockOutlined,
  ReloadOutlined,
  FilterOutlined,
  EyeOutlined,
  EditOutlined,
  DownloadOutlined,
  UploadOutlined,
  CloseCircleOutlined,
  FileTextOutlined,
  ReadOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import api from '../../utils/api';

const { Search } = Input;
const { Option } = Select;

const PermissionTreeManager = ({ moduleId, onRefresh }) => {
  const { t } = useTranslation();
  
  // ==================== 状态管理 ====================
  const [loading, setLoading] = useState(false);
  const [tableData, setTableData] = useState([]);
  const [treeData, setTreeData] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterGroup, setFilterGroup] = useState(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewData, setPreviewData] = useState(null);
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 20,
    total: 0
  });
  const [groups, setGroups] = useState([]);
  const [stats, setStats] = useState({
    totalGroups: 0,
    totalTags: 0,
    totalUsers: 0,
    viewLessonPermissions: 0,
    viewPlanPermissions: 0,
    editPermissions: 0
  });

  // ==================== 数据加载 ====================
  
  useEffect(() => {
    if (moduleId) {
      loadData();
    }
  }, [moduleId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [groupsRes, permissionsRes] = await Promise.all([
        api.get('/admin/user-groups'),
        api.get(`/teaching/modules/${moduleId}/permissions`)
      ]);

      const groupsData = groupsRes.data.data || [];
      const permsData = permissionsRes.data.data || [];
      
      setGroups(groupsData);
      setPermissions(permsData);

      await buildTableAndTreeData(groupsData, permsData);
      
    } catch (error) {
      console.error('加载权限数据失败:', error);
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  const buildTableAndTreeData = async (groupsData, permsData) => {
    const tableRows = [];
    const treeNodes = [];
    let totalTags = 0;
    let totalUsers = 0;

    for (const group of groupsData) {
      const tagsRes = await api.get(`/admin/user-tags/group/${group.id}`);
      const tags = (tagsRes.data.data || []).filter(tag => tag.is_active);
      
      const groupNode = {
        title: group.name,
        key: `group-${group.id}`,
        icon: <TeamOutlined />,
        children: []
      };

      // 添加组行
      tableRows.push({
        key: `group-${group.id}`,
        type: 'group',
        id: group.id,
        name: group.name,
        parentName: '-',
        userCount: 0,
        hasViewLessonPermission: hasPermission('group', group.id, 'view_lesson', permsData),
        hasViewPlanPermission: hasPermission('group', group.id, 'view_plan', permsData),
        hasEditPermission: hasPermission('group', group.id, 'edit', permsData),
        inherited: false
      });

      // 处理标签
      for (const tag of tags) {
        totalTags++;
        
        const usersRes = await api.get(`/admin/user-tags/${tag.id}/users`);
        const users = usersRes.data.data || [];
        
        const tagNode = {
          title: `${tag.name} (${users.length})`,
          key: `tag-${tag.id}`,
          icon: <TagOutlined style={{ color: tag.color }} />,
          children: []
        };
        
        // 组的三级权限
        const hasGroupViewLesson = hasPermission('group', group.id, 'view_lesson', permsData);
        const hasGroupViewPlan = hasPermission('group', group.id, 'view_plan', permsData);
        const hasGroupEdit = hasPermission('group', group.id, 'edit', permsData);
        
        tableRows.push({
          key: `tag-${tag.id}`,
          type: 'tag',
          id: tag.id,
          name: tag.name,
          parentName: group.name,
          groupId: group.id,
          color: tag.color,
          userCount: users.length,
          hasViewLessonPermission: hasPermission('tag', tag.id, 'view_lesson', permsData) || hasGroupViewLesson,
          hasViewPlanPermission: hasPermission('tag', tag.id, 'view_plan', permsData) || hasGroupViewPlan,
          hasEditPermission: hasPermission('tag', tag.id, 'edit', permsData) || hasGroupEdit,
          inherited: hasGroupViewLesson || hasGroupViewPlan || hasGroupEdit,
          inheritedFrom: (hasGroupViewLesson || hasGroupViewPlan || hasGroupEdit) ? 'group' : null
        });

        // 处理用户
        for (const user of users) {
          totalUsers++;
          
          const userNode = {
            title: user.username,
            key: `user-${user.id}`,
            icon: <UserOutlined />,
            isLeaf: true
          };
          
          const hasTagViewLesson = hasPermission('tag', tag.id, 'view_lesson', permsData);
          const hasTagViewPlan = hasPermission('tag', tag.id, 'view_plan', permsData);
          const hasTagEdit = hasPermission('tag', tag.id, 'edit', permsData);
          
          tableRows.push({
            key: `user-${user.id}`,
            type: 'user',
            id: user.id,
            name: user.username,
            email: user.email,
            parentName: tag.name,
            groupId: group.id,
            tagId: tag.id,
            userCount: '-',
            hasViewLessonPermission: 
              hasPermission('user', user.id, 'view_lesson', permsData) || 
              hasTagViewLesson || hasGroupViewLesson,
            hasViewPlanPermission: 
              hasPermission('user', user.id, 'view_plan', permsData) || 
              hasTagViewPlan || hasGroupViewPlan,
            hasEditPermission: 
              hasPermission('user', user.id, 'edit', permsData) || 
              hasTagEdit || hasGroupEdit,
            inherited: hasTagViewLesson || hasGroupViewLesson || hasTagViewPlan || hasGroupViewPlan || hasTagEdit || hasGroupEdit,
            inheritedFrom: 
              hasGroupViewLesson || hasGroupViewPlan || hasGroupEdit ? 'group' : 
              hasTagViewLesson || hasTagViewPlan || hasTagEdit ? 'tag' : null
          });
          
          tagNode.children.push(userNode);
        }
        
        groupNode.children.push(tagNode);
      }
      
      treeNodes.push(groupNode);
    }

    setTableData(tableRows);
    setTreeData(treeNodes);
    setPagination(prev => ({ ...prev, total: tableRows.length }));
    
    // 更新三级统计
    const viewLessonPerms = permsData.filter(p => p.permission_type === 'view_lesson').length;
    const viewPlanPerms = permsData.filter(p => p.permission_type === 'view_plan').length;
    const editPerms = permsData.filter(p => p.permission_type === 'edit').length;
    
    setStats({
      totalGroups: groupsData.length,
      totalTags,
      totalUsers,
      viewLessonPermissions: viewLessonPerms,
      viewPlanPermissions: viewPlanPerms,
      editPermissions: editPerms
    });
  };

  const hasPermission = (targetType, targetId, permType, permsData = permissions) => {
    return permsData.some(p => {
      if (p.permission_type !== permType) return false;
      
      if (targetType === 'group') {
        return p.group_id === targetId;
      } else if (targetType === 'tag') {
        return p.tag_id === targetId;
      } else if (targetType === 'user') {
        return p.user_id === targetId;
      }
      return false;
    });
  };

  // ==================== 权限操作（三级级联逻辑）====================
  
  /**
   * 权限切换处理（核心：实现级联逻辑）
   * 
   * 级联规则：
   * 1. 授予 edit → 自动授予 view_plan 和 view_lesson
   * 2. 授予 view_plan → 自动授予 view_lesson
   * 3. 撤销 view_lesson → 自动撤销 view_plan 和 edit
   * 4. 撤销 view_plan → 自动撤销 edit
   */
  const handleTogglePermission = async (record, permType, checked) => {
    setLoading(true);
    try {
      if (checked) {
        // 授权逻辑：向下级联
        const permissionsToGrant = [permType];
        
        if (permType === 'edit') {
          permissionsToGrant.push('view_plan', 'view_lesson');
        } else if (permType === 'view_plan') {
          permissionsToGrant.push('view_lesson');
        }
        
        // 去重并授权
        const uniquePerms = [...new Set(permissionsToGrant)];
        
        for (const perm of uniquePerms) {
          // 检查是否已有该权限
          const alreadyHas = hasPermission(record.type, record.id, perm);
          if (alreadyHas) continue;
          
          const data = {
            module_id: moduleId,
            permission_type: perm
          };
          
          if (record.type === 'group') data.group_id = record.id;
          else if (record.type === 'tag') data.tag_id = record.id;
          else if (record.type === 'user') data.user_id = record.id;

          await api.post('/teaching/permissions', data);
        }
        
        const permNames = {
          'view_lesson': '查看课程',
          'view_plan': '查看教案',
          'edit': '编辑'
        };
        
        message.success(`已授予 ${record.name} ${permNames[permType]}权限${uniquePerms.length > 1 ? '（及其依赖权限）' : ''}`);
        
      } else {
        // 撤销逻辑：向上级联
        const permissionsToRevoke = [permType];
        
        if (permType === 'view_lesson') {
          permissionsToRevoke.push('view_plan', 'edit');
        } else if (permType === 'view_plan') {
          permissionsToRevoke.push('edit');
        }
        
        // 撤销所有相关权限
        for (const perm of permissionsToRevoke) {
          const permToRevoke = permissions.find(p => {
            if (p.permission_type !== perm) return false;
            
            if (record.type === 'group') return p.group_id === record.id;
            else if (record.type === 'tag') return p.tag_id === record.id;
            else if (record.type === 'user') return p.user_id === record.id;
            return false;
          });
          
          if (permToRevoke) {
            await api.delete(`/teaching/permissions/${permToRevoke.id}`);
          }
        }
        
        const permNames = {
          'view_lesson': '查看课程',
          'view_plan': '查看教案',
          'edit': '编辑'
        };
        
        message.success(`已撤销 ${record.name} 的${permNames[permType]}权限${permissionsToRevoke.length > 1 ? '（及其依赖权限）' : ''}`);
      }

      await loadData();
      if (onRefresh) onRefresh();
    } catch (error) {
      message.error(error.response?.data?.message || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  const handleBatchOperation = async (operation) => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要操作的项');
      return;
    }

    setLoading(true);
    let successCount = 0;
    
    try {
      for (const key of selectedRowKeys) {
        const record = tableData.find(r => r.key === key);
        if (!record) continue;
        
        if (operation === 'grantViewLesson' || operation === 'grantViewPlan' || operation === 'grantEdit') {
          const permType = 
            operation === 'grantViewLesson' ? 'view_lesson' : 
            operation === 'grantViewPlan' ? 'view_plan' : 
            'edit';
          
          const hasPermAlready = 
            permType === 'view_lesson' ? record.hasViewLessonPermission :
            permType === 'view_plan' ? record.hasViewPlanPermission :
            record.hasEditPermission;
          
          if (!hasPermAlready && !record.inherited) {
            // 级联授权
            const permissionsToGrant = [permType];
            
            if (permType === 'edit') {
              permissionsToGrant.push('view_plan', 'view_lesson');
            } else if (permType === 'view_plan') {
              permissionsToGrant.push('view_lesson');
            }
            
            const uniquePerms = [...new Set(permissionsToGrant)];
            
            for (const perm of uniquePerms) {
              const alreadyHas = hasPermission(record.type, record.id, perm);
              if (alreadyHas) continue;
              
              const data = {
                module_id: moduleId,
                permission_type: perm
              };
              
              if (record.type === 'group') data.group_id = record.id;
              else if (record.type === 'tag') data.tag_id = record.id;
              else if (record.type === 'user') data.user_id = record.id;

              await api.post('/teaching/permissions', data);
            }
            
            successCount++;
          }
        } else if (operation === 'revokeAll') {
          // 撤销所有权限
          for (const permType of ['view_lesson', 'view_plan', 'edit']) {
            const perm = permissions.find(p => {
              if (p.permission_type !== permType) return false;
              
              if (record.type === 'group') return p.group_id === record.id;
              else if (record.type === 'tag') return p.tag_id === record.id;
              else if (record.type === 'user') return p.user_id === record.id;
              return false;
            });
            
            if (perm) {
              await api.delete(`/teaching/permissions/${perm.id}`);
              successCount++;
            }
          }
        }
      }
      
      message.success(`成功操作 ${successCount} 项`);
      setSelectedRowKeys([]);
      await loadData();
      if (onRefresh) onRefresh();
    } catch (error) {
      message.error('批量操作失败');
    } finally {
      setLoading(false);
    }
  };

  const handlePreview = (record) => {
    const previewInfo = {
      name: record.name,
      type: record.type,
      directPermissions: [],
      inheritedPermissions: [],
      effectivePermissions: []
    };
    
    // 直接权限（三级）
    if (hasPermission(record.type, record.id, 'view_lesson')) {
      previewInfo.directPermissions.push({ type: 'view_lesson', source: 'direct' });
    }
    if (hasPermission(record.type, record.id, 'view_plan')) {
      previewInfo.directPermissions.push({ type: 'view_plan', source: 'direct' });
    }
    if (hasPermission(record.type, record.id, 'edit')) {
      previewInfo.directPermissions.push({ type: 'edit', source: 'direct' });
    }
    
    // 继承权限
    if (record.inherited && record.inheritedFrom) {
      if (record.hasViewLessonPermission) {
        previewInfo.inheritedPermissions.push({ 
          type: 'view_lesson', 
          source: record.inheritedFrom === 'group' ? `组 ${record.parentName}` : `标签 ${record.parentName}`
        });
      }
      if (record.hasViewPlanPermission) {
        previewInfo.inheritedPermissions.push({ 
          type: 'view_plan', 
          source: record.inheritedFrom === 'group' ? `组 ${record.parentName}` : `标签 ${record.parentName}`
        });
      }
      if (record.hasEditPermission) {
        previewInfo.inheritedPermissions.push({ 
          type: 'edit', 
          source: record.inheritedFrom === 'group' ? `组 ${record.parentName}` : `标签 ${record.parentName}`
        });
      }
    }
    
    // 最终生效权限
    if (record.hasViewLessonPermission) {
      previewInfo.effectivePermissions.push('查看课程');
    }
    if (record.hasViewPlanPermission) {
      previewInfo.effectivePermissions.push('查看教案');
    }
    if (record.hasEditPermission) {
      previewInfo.effectivePermissions.push('编辑');
    }
    
    setPreviewData(previewInfo);
    setPreviewVisible(true);
  };

  // ==================== 过滤和搜索 ====================
  
  const filteredData = useMemo(() => {
    let filtered = [...tableData];
    
    if (filterType !== 'all') {
      filtered = filtered.filter(item => item.type === filterType);
    }
    
    if (filterGroup) {
      filtered = filtered.filter(item => item.groupId === filterGroup);
    }
    
    if (searchText) {
      filtered = filtered.filter(item =>
        item.name.toLowerCase().includes(searchText.toLowerCase()) ||
        (item.email && item.email.toLowerCase().includes(searchText.toLowerCase()))
      );
    }
    
    return filtered;
  }, [tableData, filterType, filterGroup, searchText]);

  const paginatedData = useMemo(() => {
    const { current, pageSize } = pagination;
    const start = (current - 1) * pageSize;
    return filteredData.slice(start, start + pageSize);
  }, [filteredData, pagination]);

  // ==================== 表格配置（三列版）====================
  
  const columns = [
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 80,
      fixed: 'left',
      render: (type) => {
        const config = {
          group: { icon: <TeamOutlined />, color: 'blue' },
          tag: { icon: <TagOutlined />, color: 'green' },
          user: { icon: <UserOutlined />, color: 'orange' }
        };
        return (
          <Tag icon={config[type].icon} color={config[type].color}>
            {type === 'group' ? '组' : type === 'tag' ? '标签' : '用户'}
          </Tag>
        );
      }
    },
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      render: (text, record) => (
        <Space>
          <span style={{ fontWeight: 500 }}>{text}</span>
          {record.color && (
            <Tag color={record.color} style={{ marginLeft: 8 }}>
              {record.color}
            </Tag>
          )}
          {record.email && (
            <Tooltip title={record.email}>
              <span style={{ color: '#999', fontSize: 12 }}>
                ({record.email.split('@')[0]})
              </span>
            </Tooltip>
          )}
        </Space>
      )
    },
    {
      title: '所属',
      dataIndex: 'parentName',
      key: 'parentName',
      width: 150
    },
    {
      title: '用户数',
      dataIndex: 'userCount',
      key: 'userCount',
      width: 80,
      align: 'center',
      render: (count) => count === '-' ? '-' : <Badge count={count} showZero />
    },
    {
      title: (
        <Tooltip title="学生权限 - 仅查看课程内容">
          <Space>
            <ReadOutlined />
            查看课程
          </Space>
        </Tooltip>
      ),
      key: 'viewLessonPermission',
      width: 140,
      align: 'center',
      render: (_, record) => (
        <Space>
          <Switch
            checked={record.hasViewLessonPermission}
            disabled={record.inherited && record.hasViewLessonPermission}
            onChange={(checked) => handleTogglePermission(record, 'view_lesson', checked)}
            checkedChildren={<CheckCircleOutlined />}
            unCheckedChildren={<CloseCircleOutlined />}
          />
          {record.inherited && record.hasViewLessonPermission && (
            <Tooltip title={`继承自${record.inheritedFrom === 'group' ? '组' : '标签'}`}>
              <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>继承</Tag>
            </Tooltip>
          )}
        </Space>
      )
    },
    {
      title: (
        <Tooltip title="教师权限 - 查看课程+教案">
          <Space>
            <FileTextOutlined />
            查看教案
          </Space>
        </Tooltip>
      ),
      key: 'viewPlanPermission',
      width: 140,
      align: 'center',
      render: (_, record) => (
        <Space>
          <Switch
            checked={record.hasViewPlanPermission}
            disabled={record.inherited && record.hasViewPlanPermission}
            onChange={(checked) => handleTogglePermission(record, 'view_plan', checked)}
            checkedChildren={<CheckCircleOutlined />}
            unCheckedChildren={<CloseCircleOutlined />}
          />
          {record.inherited && record.hasViewPlanPermission && (
            <Tooltip title={`继承自${record.inheritedFrom === 'group' ? '组' : '标签'}`}>
              <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>继承</Tag>
            </Tooltip>
          )}
        </Space>
      )
    },
    {
      title: (
        <Tooltip title="完全控制 - 查看课程+教案+编辑">
          <Space>
            <EditOutlined />
            编辑权限
          </Space>
        </Tooltip>
      ),
      key: 'editPermission',
      width: 140,
      align: 'center',
      render: (_, record) => (
        <Space>
          <Switch
            checked={record.hasEditPermission}
            disabled={record.inherited && record.hasEditPermission}
            onChange={(checked) => handleTogglePermission(record, 'edit', checked)}
            checkedChildren={<CheckCircleOutlined />}
            unCheckedChildren={<CloseCircleOutlined />}
          />
          {record.inherited && record.hasEditPermission && (
            <Tooltip title={`继承自${record.inheritedFrom === 'group' ? '组' : '标签'}`}>
              <Tag color="blue" style={{ margin: 0, fontSize: 10 }}>继承</Tag>
            </Tooltip>
          )}
        </Space>
      )
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      fixed: 'right',
      render: (_, record) => (
        <Button
          size="small"
          icon={<EyeOutlined />}
          onClick={() => handlePreview(record)}
        >
          预览
        </Button>
      )
    }
  ];

  const rowSelection = {
    selectedRowKeys,
    onChange: setSelectedRowKeys,
    selections: [
      Table.SELECTION_ALL,
      Table.SELECTION_INVERT,
      {
        key: 'groups',
        text: '选择所有组',
        onSelect: () => {
          const groupKeys = tableData.filter(item => item.type === 'group').map(item => item.key);
          setSelectedRowKeys(groupKeys);
        }
      },
      {
        key: 'tags',
        text: '选择所有标签',
        onSelect: () => {
          const tagKeys = tableData.filter(item => item.type === 'tag').map(item => item.key);
          setSelectedRowKeys(tagKeys);
        }
      }
    ]
  };

  // ==================== 主渲染 ====================
  
  return (
    <div>
      {/* 统计卡片（6列版）*/}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={4}>
          <Card size="small">
            <Statistic
              title="组织数"
              value={stats.totalGroups}
              prefix={<TeamOutlined />}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic
              title="标签数"
              value={stats.totalTags}
              prefix={<TagOutlined />}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small">
            <Statistic
              title="用户数"
              value={stats.totalUsers}
              prefix={<UserOutlined />}
            />
          </Card>
        </Col>
        <Col span={3}>
          <Card size="small">
            <Statistic
              title="查看课程"
              value={stats.viewLessonPermissions}
              prefix={<ReadOutlined />}
              valueStyle={{ fontSize: 20 }}
            />
          </Card>
        </Col>
        <Col span={3}>
          <Card size="small">
            <Statistic
              title="查看教案"
              value={stats.viewPlanPermissions}
              prefix={<FileTextOutlined />}
              valueStyle={{ fontSize: 20 }}
            />
          </Card>
        </Col>
        <Col span={3}>
          <Card size="small">
            <Statistic
              title="编辑权限"
              value={stats.editPermissions}
              prefix={<EditOutlined />}
              valueStyle={{ fontSize: 20 }}
            />
          </Card>
        </Col>
        <Col span={3}>
          <Card size="small">
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              onClick={loadData}
              loading={loading}
              block
              style={{ marginTop: 8 }}
            >
              刷新
            </Button>
          </Card>
        </Col>
      </Row>

      {/* 搜索和筛选栏 */}
      <Card style={{ marginBottom: 16 }}>
        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space wrap>
            <Search
              placeholder="搜索名称或邮箱"
              allowClear
              style={{ width: 250 }}
              onSearch={setSearchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
            <Select
              style={{ width: 120 }}
              placeholder="类型"
              value={filterType}
              onChange={setFilterType}
            >
              <Option value="all">全部类型</Option>
              <Option value="group">仅组织</Option>
              <Option value="tag">仅标签</Option>
              <Option value="user">仅用户</Option>
            </Select>
            <Select
              style={{ width: 150 }}
              placeholder="选择组织"
              value={filterGroup}
              onChange={setFilterGroup}
              allowClear
            >
              {groups.map(group => (
                <Option key={group.id} value={group.id}>{group.name}</Option>
              ))}
            </Select>
          </Space>
          
          {selectedRowKeys.length > 0 && (
            <Space>
              <span>已选择 {selectedRowKeys.length} 项</span>
              <Button
                type="primary"
                icon={<ReadOutlined />}
                onClick={() => handleBatchOperation('grantViewLesson')}
              >
                批量授予查看课程
              </Button>
              <Button
                icon={<FileTextOutlined />}
                onClick={() => handleBatchOperation('grantViewPlan')}
              >
                批量授予查看教案
              </Button>
              <Button
                icon={<UnlockOutlined />}
                onClick={() => handleBatchOperation('grantEdit')}
              >
                批量授予编辑
              </Button>
              <Button
                danger
                icon={<MinusCircleOutlined />}
                onClick={() => handleBatchOperation('revokeAll')}
              >
                批量撤销
              </Button>
            </Space>
          )}
        </Space>
      </Card>

      {/* 权限说明（三级版）*/}
      <Alert
        message="三级权限体系说明"
        description={
          <div>
            <h4 style={{ marginTop: 8 }}>权限层级：</h4>
            <ul style={{ marginBottom: 8, paddingLeft: 20 }}>
              <li><strong>Level 1 - 查看课程：</strong>学生权限，仅能查看课程内容</li>
              <li><strong>Level 2 - 查看教案：</strong>教师权限，可查看课程+教案</li>
              <li><strong>Level 3 - 编辑权限：</strong>完全控制，可查看课程+教案+编辑</li>
            </ul>
            <h4 style={{ marginTop: 8 }}>级联规则：</h4>
            <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
              <li>授予高级权限时，自动授予所有下级权限</li>
              <li>撤销低级权限时，自动撤销所有上级权限</li>
              <li>组权限→标签权限→用户权限，继承的权限无法单独撤销</li>
            </ul>
          </div>
        }
        type="info"
        showIcon
        closable
        style={{ marginBottom: 16 }}
      />

      {/* 数据表格 */}
      <Card>
        <Table
          rowSelection={rowSelection}
          columns={columns}
          dataSource={paginatedData}
          loading={loading}
          pagination={{
            ...pagination,
            total: filteredData.length,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条记录`,
            pageSizeOptions: ['10', '20', '50', '100'],
            onChange: (page, pageSize) => {
              setPagination(prev => ({ ...prev, current: page, pageSize }));
            }
          }}
          scroll={{ x: 1200 }}
          size="middle"
        />
      </Card>

      {/* 权限预览抽屉（三级版）*/}
      <Drawer
        title="权限详情预览"
        placement="right"
        width={450}
        open={previewVisible}
        onClose={() => setPreviewVisible(false)}
      >
        {previewData && (
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <div>
              <h3>{previewData.name}</h3>
              <Tag>{previewData.type === 'group' ? '组织' : previewData.type === 'tag' ? '标签' : '用户'}</Tag>
            </div>
            
            <Divider />
            
            <div>
              <h4>直接权限</h4>
              {previewData.directPermissions.length > 0 ? (
                <Space wrap>
                  {previewData.directPermissions.map((perm, idx) => (
                    <Tag key={idx} color="green">
                      {perm.type === 'view_lesson' ? '查看课程' : 
                       perm.type === 'view_plan' ? '查看教案' : '编辑'}
                    </Tag>
                  ))}
                </Space>
              ) : (
                <span style={{ color: '#999' }}>无直接权限</span>
              )}
            </div>
            
            <div>
              <h4>继承权限</h4>
              {previewData.inheritedPermissions.length > 0 ? (
                <Space direction="vertical" style={{ width: '100%' }}>
                  {previewData.inheritedPermissions.map((perm, idx) => (
                    <div key={idx}>
                      <Tag color="blue">
                        {perm.type === 'view_lesson' ? '查看课程' : 
                         perm.type === 'view_plan' ? '查看教案' : '编辑'}
                      </Tag>
                      <span style={{ marginLeft: 8, color: '#666' }}>
                        继承自 {perm.source}
                      </span>
                    </div>
                  ))}
                </Space>
              ) : (
                <span style={{ color: '#999' }}>无继承权限</span>
              )}
            </div>
            
            <Divider />
            
            <div>
              <h4>最终生效权限</h4>
              {previewData.effectivePermissions.length > 0 ? (
                <Space wrap>
                  {previewData.effectivePermissions.map((perm, idx) => (
                    <Tag key={idx} color="success" style={{ fontSize: 14 }}>
                      {perm}
                    </Tag>
                  ))}
                </Space>
              ) : (
                <Tag color="error">无任何权限</Tag>
              )}
            </div>
          </Space>
        )}
      </Drawer>
      
      {/* 树形结构预览（可选显示） */}
      <Card
        title="组织结构树"
        extra={
          <Button
            type="text"
            icon={<EyeOutlined />}
            onClick={() => {
              const treeCard = document.getElementById('tree-structure-card');
              if (treeCard) {
                treeCard.style.display = treeCard.style.display === 'none' ? 'block' : 'none';
              }
            }}
          >
            切换显示
          </Button>
        }
        style={{ marginTop: 16, display: 'none' }}
        id="tree-structure-card"
      >
        <Tree
          treeData={treeData}
          defaultExpandAll
          showIcon
          showLine={{ showLeafIcon: false }}
          height={400}
        />
      </Card>
    </div>
  );
};

export default PermissionTreeManager;
