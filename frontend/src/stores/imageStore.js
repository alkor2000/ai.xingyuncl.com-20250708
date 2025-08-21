/**
 * 图像生成状态管理
 */

import { create } from 'zustand';
import api from '../utils/api';
import { message } from 'antd';

const useImageStore = create((set, get) => ({
  // 状态
  models: [],
  selectedModel: null,
  generating: false,
  generationProgress: null,
  generationHistory: [],
  historyPagination: {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0
  },
  publicGallery: [],
  galleryPagination: {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0
  },
  userStats: null,
  loading: false,
  
  // Midjourney相关状态
  midjourneyTasks: [], // 进行中的Midjourney任务
  pollingTimers: {}, // 轮询定时器
  processingTasks: {}, // 正在处理的任务状态

  // 获取可用模型列表
  getModels: async () => {
    try {
      set({ loading: true });
      const response = await api.get('/image/models');
      if (response.data.success) {
        set({ 
          models: response.data.data,
          selectedModel: response.data.data[0] || null
        });
      }
    } catch (error) {
      console.error('获取模型列表失败:', error);
      message.error('获取模型列表失败');
    } finally {
      set({ loading: false });
    }
  },

  // 选择模型
  selectModel: (model) => {
    set({ selectedModel: model });
  },
  
  // 检查是否为Midjourney模型
  isMidjourneyModel: (model) => {
    return model && model.provider === 'midjourney' && model.generation_type === 'async';
  },

  // 批量生成图片（支持Midjourney）
  generateImages: async (params) => {
    const { selectedModel } = get();
    if (!selectedModel) {
      message.error('请先选择模型');
      return null;
    }

    try {
      set({ generating: true, generationProgress: null });
      
      // 判断是否为Midjourney模型
      if (get().isMidjourneyModel(selectedModel)) {
        // Midjourney生成（异步）
        message.loading('正在提交Midjourney任务...', 0);
        
        const response = await api.post('/image/generate', {
          model_id: selectedModel.id,
          prompt: params.prompt,
          negative_prompt: params.negative_prompt,
          size: params.size,
          mode: params.mode || 'fast'
        });
        
        message.destroy();
        
        if (response.data.success) {
          const result = response.data.data;
          message.success(result.message || '任务已提交，正在生成中...');
          
          // 标记任务为处理中
          set(state => ({
            processingTasks: { ...state.processingTasks, [result.taskId]: true }
          }));
          
          // 开始轮询任务状态
          get().pollMidjourneyTask(result.taskId, result.generationId);
          
          // 立即刷新历史记录，显示处理中的任务
          get().getUserHistory();
          
          return result;
        } else {
          message.error(response.data.message || '提交失败');
          return null;
        }
      } else {
        // 普通模型生成（同步）
        const quantity = params.quantity || 1;
        if (quantity > 1) {
          set({ generationProgress: `0/${quantity}` });
          message.loading(`正在生成 ${quantity} 张图片，请稍候...`, 0);
        }

        const response = await api.post('/image/generate', {
          model_id: selectedModel.id,
          ...params
        });

        if (response.data.success) {
          const result = response.data.data;
          
          message.destroy();
          
          if (quantity > 1) {
            if (result.succeeded === result.requested) {
              message.success(`成功生成 ${result.succeeded} 张图片，消耗 ${result.creditsConsumed} 积分`);
            } else if (result.succeeded > 0) {
              message.warning(`部分成功：生成了 ${result.succeeded}/${result.requested} 张图片，消耗 ${result.creditsConsumed} 积分`);
            } else {
              message.error('所有图片生成失败');
            }
          } else {
            message.success('图片生成成功');
          }
          
          // 刷新历史记录
          get().getUserHistory();
          return result;
        } else {
          message.destroy();
          message.error(response.data.message || '生成失败');
          return null;
        }
      }
    } catch (error) {
      message.destroy();
      console.error('生成图片失败:', error);
      if (error.response?.data?.message) {
        message.error(error.response.data.message);
      } else {
        message.error('生成图片失败，请稍后重试');
      }
      return null;
    } finally {
      set({ generating: false, generationProgress: null });
    }
  },
  
  // 轮询Midjourney任务状态
  pollMidjourneyTask: (taskId, generationId) => {
    const pollInterval = 2000; // 2秒轮询一次
    const maxPollingTime = 300000; // 最大轮询5分钟
    const startTime = Date.now();
    
    const poll = async () => {
      try {
        const response = await api.get(`/image/midjourney/task/${taskId}`);
        
        if (response.data.success) {
          const task = response.data.data;
          
          // 更新进度
          if (task.progress) {
            set({ generationProgress: task.progress });
          }
          
          // 检查任务状态
          if (task.task_status === 'SUCCESS' || task.status === 'success') {
            // 任务完成
            message.success('Midjourney生成完成！');
            
            // 清除轮询定时器
            get().clearPollingTimer(taskId);
            
            // 清除进度
            set({ generationProgress: null });
            
            // 重要：等待后端完成图片下载和保存
            // 这是必要的，因为后端需要时间下载Midjourney的图片并保存到本地
            // 不能立即清除processingTasks，否则会出现图片还没准备好就显示完成的问题
            console.log('任务成功，等待后端保存图片...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // 尝试获取最新数据，确保图片已经保存
            // 最多重试3次，每次间隔1.5秒
            let retryCount = 0;
            let dataReady = false;
            
            while (retryCount < 3 && !dataReady) {
              // 获取最新历史记录
              const historyResponse = await api.get('/image/history', { 
                params: { page: 1, limit: 20 } 
              });
              
              if (historyResponse.data.success) {
                const historyData = historyResponse.data.data.data;
                // 查找对应的任务记录
                const targetItem = historyData.find(item => item.task_id === taskId);
                
                // 检查图片是否已经准备好
                if (targetItem && (targetItem.local_path || targetItem.thumbnail_path || targetItem.image_url)) {
                  dataReady = true;
                  console.log('图片数据已准备好:', targetItem);
                  
                  // 更新历史记录
                  set({
                    generationHistory: historyData,
                    historyPagination: historyResponse.data.data.pagination
                  });
                }
              }
              
              if (!dataReady) {
                retryCount++;
                if (retryCount < 3) {
                  console.log(`图片数据未准备好，等待后重试... (${retryCount}/3)`);
                  await new Promise(resolve => setTimeout(resolve, 1500));
                }
              }
            }
            
            // 只有在确认数据准备好或重试完成后才清除处理状态
            // 这样可以避免出现"空白"状态
            set(state => {
              const newProcessingTasks = { ...state.processingTasks };
              delete newProcessingTasks[taskId];
              return { processingTasks: newProcessingTasks };
            });
            
            // 如果数据还没准备好，再刷新一次
            if (!dataReady) {
              console.log('数据可能还未完全准备好，最后刷新一次');
              get().getUserHistory();
            }
            
          } else if (task.task_status === 'FAILURE' || task.status === 'failed') {
            // 任务失败
            message.error(task.fail_reason || task.error_message || '生成失败');
            
            // 清除轮询定时器
            get().clearPollingTimer(taskId);
            
            // 失败时立即清除处理状态，这样用户可以看到失败状态并删除
            set(state => {
              const newProcessingTasks = { ...state.processingTasks };
              delete newProcessingTasks[taskId];
              return { 
                processingTasks: newProcessingTasks,
                generationProgress: null 
              };
            });
            
            // 延迟刷新历史记录，确保UI更新
            setTimeout(() => {
              get().getUserHistory();
            }, 500);
            
          } else if (Date.now() - startTime > maxPollingTime) {
            // 超时
            message.error('任务超时');
            
            // 清除轮询定时器
            get().clearPollingTimer(taskId);
            
            // 超时也要清除处理状态，让用户可以操作
            set(state => {
              const newProcessingTasks = { ...state.processingTasks };
              delete newProcessingTasks[taskId];
              return { processingTasks: newProcessingTasks, generationProgress: null };
            });
            
            // 刷新历史记录
            get().getUserHistory();
            
          } else {
            // 继续轮询
            const timerId = setTimeout(poll, pollInterval);
            set(state => ({
              pollingTimers: { ...state.pollingTimers, [taskId]: timerId }
            }));
          }
        }
      } catch (error) {
        console.error('轮询任务状态失败:', error);
        // 继续轮询，但增加间隔
        const timerId = setTimeout(poll, pollInterval * 2);
        set(state => ({
          pollingTimers: { ...state.pollingTimers, [taskId]: timerId }
        }));
      }
    };
    
    // 开始轮询
    poll();
  },
  
  // 清除轮询定时器
  clearPollingTimer: (taskId) => {
    const { pollingTimers } = get();
    if (pollingTimers[taskId]) {
      clearTimeout(pollingTimers[taskId]);
      const newTimers = { ...pollingTimers };
      delete newTimers[taskId];
      set({ pollingTimers: newTimers });
    }
  },
  
  // 清理所有失败任务的处理状态
  // 这个函数很重要，用于清理那些已经失败但还在processingTasks中的任务
  cleanupFailedTasks: () => {
    const { generationHistory, processingTasks } = get();
    const newProcessingTasks = { ...processingTasks };
    let hasChanges = false;
    
    // 遍历历史记录，清理失败任务的处理状态
    generationHistory.forEach(item => {
      if (item.task_id && newProcessingTasks[item.task_id]) {
        // 如果任务已经失败或成功，清理其处理状态
        if (item.status === 'failed' || item.status === 'success' || 
            item.task_status === 'FAILURE' || item.task_status === 'SUCCESS') {
          delete newProcessingTasks[item.task_id];
          hasChanges = true;
        }
      }
    });
    
    if (hasChanges) {
      set({ processingTasks: newProcessingTasks });
      console.log('已清理失败任务的处理状态');
    }
  },
  
  // Midjourney操作（U/V/Reroll）
  midjourneyAction: async (generationId, action, index) => {
    try {
      set({ generating: true });
      message.loading('正在提交操作...', 0);
      
      const response = await api.post('/image/midjourney/action', {
        generation_id: generationId,
        action,
        index
      });
      
      message.destroy();
      
      if (response.data.success) {
        const result = response.data.data;
        message.success(result.message || '操作已提交');
        
        // 标记新任务为处理中
        set(state => ({
          processingTasks: { ...state.processingTasks, [result.taskId]: true }
        }));
        
        // 开始轮询新任务
        get().pollMidjourneyTask(result.taskId, result.generationId);
        
        // 立即刷新历史记录
        get().getUserHistory();
        
        return result;
      } else {
        message.error(response.data.message || '操作失败');
        return null;
      }
    } catch (error) {
      message.destroy();
      console.error('Midjourney操作失败:', error);
      if (error.response?.data?.message) {
        message.error(error.response.data.message);
      } else {
        message.error('操作失败，请稍后重试');
      }
      return null;
    } finally {
      set({ generating: false });
    }
  },
  
  // 获取Midjourney任务列表
  getMidjourneyTasks: async (params = {}) => {
    try {
      const response = await api.get('/image/midjourney/tasks', { params });
      if (response.data.success) {
        set({ midjourneyTasks: response.data.data.data });
        return response.data.data;
      }
    } catch (error) {
      console.error('获取任务列表失败:', error);
      message.error('获取任务列表失败');
    }
  },

  // 生成单张图片（保持兼容性）
  generateImage: async (params) => {
    return get().generateImages({ ...params, quantity: 1 });
  },

  // 获取用户生成历史（优化避免loading闪烁）
  getUserHistory: async (params = {}, skipLoading = false) => {
    try {
      // 如果是轮询触发的刷新，不显示loading
      if (!skipLoading) {
        set({ loading: true });
      }
      
      const response = await api.get('/image/history', { params });
      if (response.data.success) {
        // 更新历史记录和分页信息
        set({
          generationHistory: response.data.data.data,
          historyPagination: response.data.data.pagination,
          loading: false
        });
        
        // 每次获取历史记录后，自动清理失败任务的处理状态
        // 这确保了页面刷新后，失败的任务不会显示为"加载中"
        get().cleanupFailedTasks();
        
        // 返回数据以便调用者使用
        return response.data.data;
      }
    } catch (error) {
      console.error('获取历史记录失败:', error);
      if (!skipLoading) {
        message.error('获取历史记录失败');
      }
      set({ loading: false });
    }
  },

  // 删除生成记录
  deleteGeneration: async (id) => {
    try {
      const response = await api.delete(`/image/generation/${id}`);
      if (response.data.success) {
        message.success('删除成功');
        // 刷新历史记录
        get().getUserHistory();
        return true;
      }
      return false;
    } catch (error) {
      console.error('删除失败:', error);
      message.error('删除失败');
      return false;
    }
  },

  // 批量删除
  batchDeleteGenerations: async (ids) => {
    try {
      const response = await api.post('/image/generations/batch-delete', { ids });
      if (response.data.success) {
        message.success(response.data.message);
        // 刷新历史记录
        get().getUserHistory();
        return true;
      }
      return false;
    } catch (error) {
      console.error('批量删除失败:', error);
      message.error('批量删除失败');
      return false;
    }
  },

  // 切换收藏状态
  toggleFavorite: async (id) => {
    try {
      const response = await api.post(`/image/generation/${id}/favorite`);
      if (response.data.success) {
        // 更新本地状态而不是刷新整个列表
        set(state => ({
          generationHistory: state.generationHistory.map(item => 
            item.id === id ? { ...item, is_favorite: !item.is_favorite } : item
          )
        }));
        message.success('操作成功');
        return true;
      }
      return false;
    } catch (error) {
      console.error('切换收藏失败:', error);
      message.error('操作失败');
      return false;
    }
  },

  // 切换公开状态
  togglePublic: async (id) => {
    try {
      const response = await api.post(`/image/generation/${id}/public`);
      if (response.data.success) {
        // 更新本地状态而不是刷新整个列表
        set(state => ({
          generationHistory: state.generationHistory.map(item => 
            item.id === id ? { ...item, is_public: !item.is_public } : item
          )
        }));
        message.success('操作成功');
        return true;
      }
      return false;
    } catch (error) {
      console.error('切换公开状态失败:', error);
      message.error('操作失败');
      return false;
    }
  },

  // 获取公开画廊
  getPublicGallery: async (params = {}) => {
    try {
      set({ loading: true });
      const response = await api.get('/image/gallery', { params });
      if (response.data.success) {
        set({
          publicGallery: response.data.data.data,
          galleryPagination: response.data.data.pagination
        });
      }
    } catch (error) {
      console.error('获取画廊失败:', error);
      message.error('获取画廊失败');
    } finally {
      set({ loading: false });
    }
  },

  // 获取用户统计
  getUserStats: async () => {
    try {
      const response = await api.get('/image/stats');
      if (response.data.success) {
        set({ userStats: response.data.data });
      }
    } catch (error) {
      console.error('获取统计信息失败:', error);
    }
  },

  // 重置状态
  reset: () => {
    // 清除所有轮询定时器
    const { pollingTimers } = get();
    Object.values(pollingTimers).forEach(timerId => clearTimeout(timerId));
    
    set({
      models: [],
      selectedModel: null,
      generating: false,
      generationProgress: null,
      generationHistory: [],
      historyPagination: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0
      },
      publicGallery: [],
      galleryPagination: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0
      },
      userStats: null,
      loading: false,
      midjourneyTasks: [],
      pollingTimers: {},
      processingTasks: {}
    });
  }
}));

export default useImageStore;
