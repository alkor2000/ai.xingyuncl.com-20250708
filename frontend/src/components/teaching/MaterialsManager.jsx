/**
 * 课程资料管理组件
 * 功能：在编辑模态框中管理课程资料（最多5个）
 * 使用iOS风格设计
 */

import React, { useState, useEffect } from 'react';
import { 
  Form, 
  Input, 
  Button, 
  Space, 
  message,
  Tooltip
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  LinkOutlined,
  FileTextOutlined,
  DragOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

const { TextArea } = Input;

const MaterialsManager = ({ value = [], onChange, disabled = false }) => {
  const { t } = useTranslation();
  const [materials, setMaterials] = useState([]);

  useEffect(() => {
    // 确保materials是数组
    const initialMaterials = Array.isArray(value) ? value : [];
    setMaterials(initialMaterials);
  }, [value]);

  // 添加新资料
  const handleAdd = () => {
    if (materials.length >= 5) {
      message.warning(t('teaching.maxMaterials'));
      return;
    }

    const newMaterial = {
      title: '',
      url: '',
      description: '',
      _tempId: Date.now() // 临时ID用于React key
    };

    const newMaterials = [...materials, newMaterial];
    setMaterials(newMaterials);
    onChange?.(newMaterials);
  };

  // 更新资料
  const handleUpdate = (index, field, val) => {
    const newMaterials = [...materials];
    newMaterials[index] = {
      ...newMaterials[index],
      [field]: val
    };
    setMaterials(newMaterials);
    onChange?.(newMaterials);
  };

  // 删除资料
  const handleDelete = (index) => {
    const newMaterials = materials.filter((_, i) => i !== index);
    setMaterials(newMaterials);
    onChange?.(newMaterials);
    message.success(t('teaching.deleteSuccess'));
  };

  // 上移
  const handleMoveUp = (index) => {
    if (index === 0) return;
    const newMaterials = [...materials];
    [newMaterials[index - 1], newMaterials[index]] = [newMaterials[index], newMaterials[index - 1]];
    setMaterials(newMaterials);
    onChange?.(newMaterials);
  };

  // 下移
  const handleMoveDown = (index) => {
    if (index === materials.length - 1) return;
    const newMaterials = [...materials];
    [newMaterials[index], newMaterials[index + 1]] = [newMaterials[index + 1], newMaterials[index]];
    setMaterials(newMaterials);
    onChange?.(newMaterials);
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: 12
        }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>
            {t('teaching.courseMaterials')} 
            <span style={{ 
              color: '#999', 
              fontSize: 12, 
              marginLeft: 8 
            }}>
              ({materials.length}/5)
            </span>
          </span>
          {!disabled && materials.length < 5 && (
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={handleAdd}
              style={{
                borderRadius: 16,
                height: 28
              }}
            >
              {t('teaching.addMaterial')}
            </Button>
          )}
        </div>

        {materials.length === 0 ? (
          <div style={{
            padding: '20px 0',
            textAlign: 'center',
            background: '#F2F2F7',
            borderRadius: 12,
            color: '#999'
          }}>
            <FileTextOutlined style={{ fontSize: 32, marginBottom: 8 }} />
            <div>{t('teaching.noMaterials')}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {materials.map((material, index) => (
              <div
                key={material._tempId || index}
                style={{
                  padding: 16,
                  background: '#FFFFFF',
                  border: '1px solid #E5E5EA',
                  borderRadius: 12,
                  position: 'relative'
                }}
              >
                {/* 序号和操作按钮 */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8
                  }}>
                    <div style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #007AFF 0%, #5856D6 100%)',
                      color: 'white',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 600
                    }}>
                      {index + 1}
                    </div>
                    <LinkOutlined style={{ color: '#007AFF', fontSize: 16 }} />
                  </div>

                  {!disabled && (
                    <Space size={4}>
                      {index > 0 && (
                        <Tooltip title="上移">
                          <Button
                            type="text"
                            size="small"
                            icon={<DragOutlined rotate={180} />}
                            onClick={() => handleMoveUp(index)}
                            style={{ color: '#666' }}
                          />
                        </Tooltip>
                      )}
                      {index < materials.length - 1 && (
                        <Tooltip title="下移">
                          <Button
                            type="text"
                            size="small"
                            icon={<DragOutlined />}
                            onClick={() => handleMoveDown(index)}
                            style={{ color: '#666' }}
                          />
                        </Tooltip>
                      )}
                      <Tooltip title={t('common.delete')}>
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => handleDelete(index)}
                        />
                      </Tooltip>
                    </Space>
                  )}
                </div>

                {/* 资料表单 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <Input
                    value={material.title}
                    onChange={(e) => handleUpdate(index, 'title', e.target.value)}
                    placeholder={t('teaching.materialTitlePlaceholder')}
                    disabled={disabled}
                    style={{
                      borderRadius: 8,
                      borderColor: '#E5E5EA'
                    }}
                    addonBefore={
                      <span style={{ fontSize: 12, color: '#666' }}>
                        {t('teaching.materialTitle')}
                      </span>
                    }
                  />

                  <Input
                    value={material.url}
                    onChange={(e) => handleUpdate(index, 'url', e.target.value)}
                    placeholder={t('teaching.materialUrlPlaceholder')}
                    disabled={disabled}
                    style={{
                      borderRadius: 8,
                      borderColor: '#E5E5EA'
                    }}
                    addonBefore={
                      <span style={{ fontSize: 12, color: '#666' }}>
                        {t('teaching.materialUrl')}
                      </span>
                    }
                  />

                  <TextArea
                    value={material.description}
                    onChange={(e) => handleUpdate(index, 'description', e.target.value)}
                    placeholder={t('teaching.materialDescriptionPlaceholder')}
                    disabled={disabled}
                    rows={2}
                    style={{
                      borderRadius: 8,
                      borderColor: '#E5E5EA',
                      resize: 'none'
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MaterialsManager;
