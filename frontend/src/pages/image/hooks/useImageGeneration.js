/**
 * 图像生成业务逻辑Hook
 * 支持图生图功能
 */

import { useState, useCallback, useEffect } from 'react';
import { message } from 'antd';
import useImageStore from '../../../stores/imageStore';
import useAuthStore from '../../../stores/authStore';
import { DEFAULT_PARAMS } from '../utils/constants';
import { isMidjourneyModel, calculatePrice } from '../utils/imageHelpers';

export const useImageGeneration = () => {
  const { user } = useAuthStore();
  const {
    models,
    selectedModel,
    generating,
    generationProgress,
    getModels,
    selectModel,
    generateImages,
    isMidjourneyModel: checkMidjourney
  } = useImageStore();

  // 生成参数状态
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [selectedSize, setSelectedSize] = useState(DEFAULT_PARAMS.selectedSize);
  const [seed, setSeed] = useState(DEFAULT_PARAMS.seed);
  const [guidanceScale, setGuidanceScale] = useState(DEFAULT_PARAMS.guidanceScale);
  const [watermark, setWatermark] = useState(DEFAULT_PARAMS.watermark);
  const [quantity, setQuantity] = useState(DEFAULT_PARAMS.quantity);
  const [batchResults, setBatchResults] = useState(null);

  // 初始化模型列表
  useEffect(() => {
    getModels();
  }, [getModels]);

  // 当选择的模型改变时，调整相关参数
  useEffect(() => {
    if (selectedModel) {
      if (checkMidjourney(selectedModel)) {
        setQuantity(1); // Midjourney固定一次生成4张
      } else {
        setSelectedSize(DEFAULT_PARAMS.selectedSize);
      }
    }
  }, [selectedModel, checkMidjourney]);

  // 处理模型选择
  const handleModelChange = useCallback((modelId) => {
    const model = models.find(m => m.id === modelId);
    if (model) {
      selectModel(model);
    }
  }, [models, selectModel]);

  // 计算总价格
  const getTotalPrice = useCallback(() => {
    return calculatePrice(selectedModel, quantity);
  }, [selectedModel, quantity]);

  // 验证生成参数
  const validateGeneration = useCallback(() => {
    if (!prompt.trim()) {
      message.warning('请输入提示词');
      return false;
    }

    if (!selectedModel) {
      message.warning('请选择模型');
      return false;
    }

    // 检查积分是否充足
    const totalPrice = getTotalPrice();
    if (user.credits_stats && user.credits_stats.remaining < totalPrice) {
      message.error(`积分不足！需要 ${totalPrice} 积分，当前余额 ${user.credits_stats.remaining} 积分`);
      return false;
    }

    return true;
  }, [prompt, selectedModel, getTotalPrice, user]);

  // 处理生成
  const handleGenerate = useCallback(async (referenceImages = []) => {
    if (!validateGeneration()) {
      return null;
    }

    setBatchResults(null);

    // 准备基本参数
    const params = {
      prompt: prompt.trim(),
      negative_prompt: negativePrompt.trim(),
      size: selectedSize,
      seed: seed === -1 ? undefined : seed,
      guidance_scale: guidanceScale,
      watermark,
      quantity
    };
    
    // 检查是否是Midjourney模型
    const isMj = checkMidjourney(selectedModel);
    
    // 处理参考图片
    if (referenceImages && referenceImages.length > 0) {
      if (isMj) {
        // Midjourney使用base64格式
        params.quantity = 1; // Midjourney强制为1
        params.base64Array = referenceImages.map(img => img.base64);
      } else {
        // 普通模型使用URL格式（图生图）
        // 检查模型是否支持图生图
        const supportsImage2Image = selectedModel.api_config?.supports_image2image;
        if (!supportsImage2Image) {
          message.error('该模型不支持图生图功能');
          return null;
        }
        
        // 提取URL数组
        params.reference_images = referenceImages.map(img => img.url);
        
        // 图生图模式下强制数量为1
        params.quantity = 1;
      }
    } else if (isMj) {
      params.quantity = 1; // Midjourney即使没有参考图片也固定为1
    }

    // 调用生成服务
    const result = await generateImages(params);

    if (result) {
      // 对于Midjourney，不清空输入（可能需要继续调整）
      if (!isMj) {
        // 普通模型：显示结果并清空
        if (quantity > 1 && result.results && !referenceImages.length) {
          setBatchResults(result);
          
          if (result.succeeded === result.requested) {
            message.success(`成功生成 ${result.succeeded} 张图片，消耗 ${result.creditsConsumed} 积分`);
          } else if (result.succeeded > 0) {
            message.warning(`部分成功：生成了 ${result.succeeded}/${result.requested} 张图片，消耗 ${result.creditsConsumed} 积分`);
          }
        } else if (referenceImages.length > 0) {
          // 图生图模式的成功提示
          message.success(`图生图成功，消耗 ${result.creditsConsumed || getTotalPrice()} 积分`);
        }
        
        // 清空输入
        resetParams();
      }
      
      return result;
    }
    
    return null;
  }, [
    validateGeneration,
    prompt,
    negativePrompt,
    selectedSize,
    seed,
    guidanceScale,
    watermark,
    quantity,
    selectedModel,
    checkMidjourney,
    generateImages,
    getTotalPrice
  ]);

  // 重置参数
  const resetParams = useCallback(() => {
    setPrompt('');
    setNegativePrompt('');
    setSeed(DEFAULT_PARAMS.seed);
    setGuidanceScale(DEFAULT_PARAMS.guidanceScale);
    setWatermark(DEFAULT_PARAMS.watermark);
    // 不重置quantity，用户可能想继续使用相同数量
  }, []);

  return {
    // 状态
    models,
    selectedModel,
    generating,
    generationProgress,
    prompt,
    negativePrompt,
    selectedSize,
    seed,
    guidanceScale,
    watermark,
    quantity,
    batchResults,
    
    // 方法
    setPrompt,
    setNegativePrompt,
    setSelectedSize,
    setSeed,
    setGuidanceScale,
    setWatermark,
    setQuantity,
    handleModelChange,
    handleGenerate,
    getTotalPrice,
    resetParams
  };
};
