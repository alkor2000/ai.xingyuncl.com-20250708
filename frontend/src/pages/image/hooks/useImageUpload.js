/**
 * 图片上传Hook
 * 支持Midjourney base64和普通模型的服务器上传
 */

import { useState, useCallback } from 'react';
import { message } from 'antd';
import api from '../../../utils/api';
import { fileToBase64, validateImageFile } from '../utils/imageHelpers';
import { UPLOAD_CONFIG } from '../utils/constants';

export const useImageUpload = () => {
  const [referenceImages, setReferenceImages] = useState([]);
  const [uploadLoading, setUploadLoading] = useState(false);

  // 处理参考图片上传（新版本：支持服务器上传）
  const handleReferenceUpload = useCallback(async (uploadedImage) => {
    // 直接添加已上传的图片信息
    setReferenceImages(prev => [...prev, uploadedImage]);
  }, []);

  // 处理Midjourney参考图片上传（保留原有的base64方式）
  const handleMidjourneyUpload = useCallback(async ({ file, onSuccess, onError }) => {
    try {
      setUploadLoading(true);
      
      // 验证文件
      if (!validateImageFile(file)) {
        onError(new Error('Invalid file'));
        return false;
      }

      // 检查数量限制
      if (referenceImages.length >= UPLOAD_CONFIG.maxReferenceImages) {
        message.warning(`最多只能上传${UPLOAD_CONFIG.maxReferenceImages}张参考图片`);
        onError(new Error('Max files exceeded'));
        return false;
      }

      // 转换为base64
      const base64 = await fileToBase64(file);
      
      // 创建预览URL
      const previewUrl = URL.createObjectURL(file);
      
      // 添加到参考图片列表
      const newImage = {
        uid: file.uid,
        name: file.name,
        status: 'done',
        url: previewUrl,
        base64: base64,
        size: file.size,
        isMidjourney: true  // 标记为Midjourney格式
      };
      
      setReferenceImages(prev => [...prev, newImage]);
      onSuccess();
      
      return false; // 阻止默认上传
    } catch (error) {
      console.error('处理Midjourney参考图片失败:', error);
      message.error('处理图片失败');
      onError(error);
      return false;
    } finally {
      setUploadLoading(false);
    }
  }, [referenceImages.length]);

  // 移除参考图片
  const handleRemoveReference = useCallback((uid) => {
    setReferenceImages(prev => {
      const removed = prev.find(img => img.uid === uid);
      
      // 释放blob URL（如果是Midjourney base64方式创建的）
      if (removed && removed.url && removed.url.startsWith('blob:')) {
        URL.revokeObjectURL(removed.url);
      }
      
      // 如果是服务器上传的图片，可以选择调用删除接口
      // 但通常参考图片是临时的，不需要立即删除
      
      return prev.filter(img => img.uid !== uid);
    });
  }, []);

  // 清空所有参考图片
  const clearReferenceImages = useCallback(() => {
    // 释放所有blob URL
    referenceImages.forEach(img => {
      if (img.url && img.url.startsWith('blob:')) {
        URL.revokeObjectURL(img.url);
      }
    });
    setReferenceImages([]);
  }, [referenceImages]);

  return {
    referenceImages,
    uploadLoading,
    handleReferenceUpload,
    handleMidjourneyUpload,
    handleRemoveReference,
    clearReferenceImages
  };
};
