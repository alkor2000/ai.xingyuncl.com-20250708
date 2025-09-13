/**
 * Midjourney参考图片上传组件
 */

import React, { memo } from 'react';
import { Upload, Button, Image, Alert, Tooltip } from 'antd';
import { PlusOutlined, CloseOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { UPLOAD_CONFIG } from '../../utils/constants';

const MidjourneyUploader = memo(({
  referenceImages,
  onUpload,
  onRemove
}) => {
  const { t } = useTranslation();

  return (
    <div className="param-item">
      <div className="param-label">
        {t('image.referenceImages', '参考图片（可选）')}
        <Tooltip title={t('image.referenceImagesTip', '上传参考图片进行图生图。建议在提示词末尾添加 --iw 1 或 --iw 2 来控制参考图片的影响权重')}>
          <span className="info-icon"> ❓</span>
        </Tooltip>
      </div>
      
      <div className="reference-images-grid">
        {referenceImages.map(img => (
          <div key={img.uid} className="reference-image-item" style={{ position: 'relative', display: 'inline-block', marginRight: 8, marginBottom: 8 }}>
            <Image
              src={img.url}
              alt={img.name}
              style={{ width: 60, height: 60, objectFit: 'cover' }}
              preview={false}
            />
            <Button
              type="text"
              danger
              icon={<CloseOutlined />}
              size="small"
              onClick={() => onRemove(img.uid)}
              style={{
                position: 'absolute',
                top: -8,
                right: -8,
                background: 'rgba(255,255,255,0.9)',
                borderRadius: '50%',
                width: 20,
                height: 20,
                minWidth: 20,
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            />
          </div>
        ))}
        
        {referenceImages.length < UPLOAD_CONFIG.maxReferenceImages && (
          <Upload
            accept={UPLOAD_CONFIG.acceptedTypes}
            customRequest={onUpload}
            showUploadList={false}
            multiple={false}
          >
            <Button
              size="small"
              icon={<PlusOutlined />}
              style={{ width: 60, height: 60 }}
            >
              {t('common.add', '添加')}
            </Button>
          </Upload>
        )}
      </div>
      
      {referenceImages.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <Alert
            message={t('image.uploadedImages', '已添加 {{count}} 张参考图片', { count: referenceImages.length })}
            description={t('image.uploadedImagesTip', '提示：添加 --iw 2 可增强参考图片的影响')}
            type="info"
            showIcon={false}
            banner
          />
        </div>
      )}
    </div>
  );
});

MidjourneyUploader.displayName = 'MidjourneyUploader';

export default MidjourneyUploader;
