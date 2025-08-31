/**
 * 视频生成状态管理
 */
import { create } from 'zustand';
import apiClient from '../utils/api';
import { message } from 'antd';

const useVideoStore = create((set, get) => ({
  // 状态
  models: [],
  selectedModel: null,
  generating: false,
  generationProgress: 0,
  generationHistory: [],
  historyPagination: { total: 0, page: 1, limit: 20 },
  publicGallery: [],
  galleryPagination: { total: 0, page: 1, limit: 20 },
  loading: false,
  userStats: null,
  processingTasks: {}, // 正在处理的任务
  completedTasks: {}, // 已完成的任务（避免状态回退）

  // 获取模型列表
  getModels: async () => {
    try {
      const response = await apiClient.get('/video/models');
      if (response.data.success) {
        const models = response.data.data;
        set({ 
          models,
          selectedModel: models.length > 0 ? models[0] : null
        });
      }
    } catch (error) {
      message.error('获取视频模型失败');
    }
  },

  // 选择模型
  selectModel: (model) => {
    set({ selectedModel: model });
  },

  // 提交视频生成任务
  generateVideo: async (params) => {
    const { selectedModel } = get();
    if (!selectedModel) {
      message.error('请选择视频模型');
      return null;
    }

    set({ generating: true, generationProgress: 0 });
    
    try {
      const response = await apiClient.post('/video/generate', {
        model_id: selectedModel.id,
        ...params
      });

      if (response.data.success) {
        const result = response.data.data;
        
        // 添加到处理任务列表
        if (result.taskId) {
          set(state => ({
            processingTasks: {
              ...state.processingTasks,
              [result.taskId]: {
                generationId: result.generationId,
                startTime: Date.now()
              }
            }
          }));
          
          // 立即刷新历史记录，获取新创建的任务
          await get().getUserHistory({ page: 1, limit: 20 });
          
          // 开始轮询任务状态
          get().pollTaskStatus(result.taskId, result.generationId);
        }
        
        message.success('视频生成任务已提交');
        return result;
      }
    } catch (error) {
      const errorMsg = error.response?.data?.message || '视频生成失败';
      message.error(errorMsg);
      return null;
    } finally {
      set({ generating: false });
    }
  },

  // 轮询任务状态
  pollTaskStatus: async (taskId, generationId) => {
    const pollInterval = 5000; // 5秒
    const maxPollingTime = 600000; // 10分钟
    const startTime = Date.now();
    
    const poll = async () => {
      try {
        // 检查是否超时
        if (Date.now() - startTime > maxPollingTime) {
          message.error('任务查询超时');
          // 从处理任务列表中移除
          set(state => {
            const newTasks = { ...state.processingTasks };
            delete newTasks[taskId];
            return { processingTasks: newTasks };
          });
          return;
        }

        // 检查是否已经在已完成列表中（避免重复轮询）
        if (get().completedTasks[taskId]) {
          return;
        }

        const response = await apiClient.get(`/video/task/${taskId}`);
        
        if (response.data.success) {
          const taskData = response.data.data;
          
          // 实时更新历史记录中对应任务的状态
          set(state => ({
            generationHistory: state.generationHistory.map(item => {
              if (item.id === generationId || item.task_id === taskId) {
                return {
                  ...item,
                  status: taskData.status,
                  progress: taskData.progress || item.progress,
                  video_url: taskData.video_url || item.video_url,
                  local_path: taskData.local_path || item.local_path,
                  thumbnail_path: taskData.thumbnail_path || item.thumbnail_path,
                  error_message: taskData.error_message || item.error_message
                };
              }
              return item;
            })
          }));
          
          // 更新全局进度（如果需要）
          if (taskData.progress !== undefined) {
            set({ generationProgress: taskData.progress });
          }
          
          // 检查是否完成
          if (taskData.status === 'succeeded' || taskData.status === 'failed') {
            // 标记为已完成，防止状态回退
            set(state => ({
              completedTasks: {
                ...state.completedTasks,
                [taskId]: {
                  generationId,
                  status: taskData.status,
                  completedAt: Date.now()
                }
              },
              processingTasks: (() => {
                const newTasks = { ...state.processingTasks };
                delete newTasks[taskId];
                return newTasks;
              })(),
              generationProgress: 0
            }));
            
            // 最终更新一次状态，确保数据完整
            set(state => ({
              generationHistory: state.generationHistory.map(item => {
                if (item.id === generationId || item.task_id === taskId) {
                  return {
                    ...item,
                    status: taskData.status,
                    video_url: taskData.video_url,
                    local_path: taskData.local_path,
                    thumbnail_path: taskData.thumbnail_path,
                    error_message: taskData.error_message
                  };
                }
                return item;
              })
            }));
            
            if (taskData.status === 'succeeded') {
              message.success('视频生成完成！');
            } else {
              message.error(`视频生成失败: ${taskData.error_message || '未知错误'}`);
            }
            
            // 清理已完成任务记录（24小时后）
            setTimeout(() => {
              set(state => {
                const newCompleted = { ...state.completedTasks };
                delete newCompleted[taskId];
                return { completedTasks: newCompleted };
              });
            }, 24 * 60 * 60 * 1000);
            
          } else {
            // 继续轮询
            setTimeout(poll, pollInterval);
          }
        }
      } catch (error) {
        console.error('查询任务状态失败:', error);
        // 继续轮询，但增加间隔
        setTimeout(poll, pollInterval * 2);
      }
    };
    
    // 开始轮询
    setTimeout(poll, pollInterval);
  },

  // 获取用户历史
  getUserHistory: async (params = {}) => {
    set({ loading: true });
    try {
      const response = await apiClient.get('/video/history', { params });
      if (response.data.success) {
        const { data, pagination } = response.data.data;
        
        // 获取已完成和正在处理的任务
        const completedTasks = get().completedTasks;
        const processingTasks = get().processingTasks;
        const currentHistory = get().generationHistory;
        
        // 智能合并数据
        const mergedData = data.map(newItem => {
          // 如果任务已完成，不要覆盖其状态
          if (completedTasks[newItem.task_id]) {
            const currentItem = currentHistory.find(item => item.task_id === newItem.task_id);
            if (currentItem && (currentItem.status === 'succeeded' || currentItem.status === 'failed')) {
              // 保留已完成任务的最终状态
              return {
                ...newItem,
                status: currentItem.status,
                video_url: currentItem.video_url || newItem.video_url,
                local_path: currentItem.local_path || newItem.local_path,
                thumbnail_path: currentItem.thumbnail_path || newItem.thumbnail_path,
                error_message: currentItem.error_message || newItem.error_message
              };
            }
          }
          
          // 如果任务正在处理，保留实时更新的状态
          if (processingTasks[newItem.task_id]) {
            const currentItem = currentHistory.find(item => item.task_id === newItem.task_id);
            if (currentItem && currentItem.status !== 'submitted') {
              // 保留轮询更新的状态，除非是初始状态
              return {
                ...newItem,
                status: currentItem.status || newItem.status,
                progress: currentItem.progress !== undefined ? currentItem.progress : newItem.progress
              };
            }
          }
          
          return newItem;
        });
        
        set({ 
          generationHistory: mergedData,
          historyPagination: pagination
        });
        
        // 恢复未完成任务的轮询
        mergedData.forEach(item => {
          if (item.task_id && 
              (item.status === 'running' || item.status === 'queued' || item.status === 'submitted') &&
              !processingTasks[item.task_id] && 
              !completedTasks[item.task_id]) {
            // 添加到处理列表并开始轮询
            set(state => ({
              processingTasks: {
                ...state.processingTasks,
                [item.task_id]: {
                  generationId: item.id,
                  startTime: Date.now()
                }
              }
            }));
            get().pollTaskStatus(item.task_id, item.id);
          }
        });
      }
    } catch (error) {
      console.error('获取历史记录失败:', error);
      // 暂时忽略错误，因为可能是空数据导致的SQL问题
      set({ 
        generationHistory: [],
        historyPagination: { total: 0, page: 1, limit: 20 }
      });
    } finally {
      set({ loading: false });
    }
  },

  // 获取公开画廊
  getPublicGallery: async (params = {}) => {
    set({ loading: true });
    try {
      const response = await apiClient.get('/video/gallery', { params });
      if (response.data.success) {
        const { data, pagination } = response.data.data;
        set({ 
          publicGallery: data,
          galleryPagination: pagination
        });
      }
    } catch (error) {
      message.error('获取公开画廊失败');
    } finally {
      set({ loading: false });
    }
  },

  // 删除视频
  deleteGeneration: async (id) => {
    try {
      const response = await apiClient.delete(`/video/generation/${id}`);
      if (response.data.success) {
        message.success('删除成功');
        
        // 获取要删除项的task_id
        const itemToDelete = get().generationHistory.find(item => item.id === id);
        
        // 更新列表
        set(state => {
          // 如果有task_id，从各种任务列表中清理
          const newState = {
            generationHistory: state.generationHistory.filter(item => item.id !== id),
            historyPagination: {
              ...state.historyPagination,
              total: Math.max(0, state.historyPagination.total - 1)
            }
          };
          
          if (itemToDelete?.task_id) {
            const newProcessing = { ...state.processingTasks };
            delete newProcessing[itemToDelete.task_id];
            newState.processingTasks = newProcessing;
            
            const newCompleted = { ...state.completedTasks };
            delete newCompleted[itemToDelete.task_id];
            newState.completedTasks = newCompleted;
          }
          
          return newState;
        });
        
        return true;
      }
    } catch (error) {
      message.error('删除失败');
      return false;
    }
  },

  // 切换收藏
  toggleFavorite: async (id) => {
    try {
      const response = await apiClient.post(`/video/generation/${id}/favorite`);
      if (response.data.success) {
        // 更新列表中的收藏状态
        set(state => ({
          generationHistory: state.generationHistory.map(item =>
            item.id === id ? { ...item, is_favorite: !item.is_favorite } : item
          )
        }));
        message.success(response.data.data?.is_favorite ? '已收藏' : '已取消收藏');
        return true;
      }
    } catch (error) {
      message.error('操作失败');
      return false;
    }
  },

  // 切换公开状态
  togglePublic: async (id) => {
    try {
      const response = await apiClient.post(`/video/generation/${id}/public`);
      if (response.data.success) {
        // 更新列表中的公开状态
        set(state => ({
          generationHistory: state.generationHistory.map(item =>
            item.id === id ? { ...item, is_public: !item.is_public } : item
          )
        }));
        message.success(response.data.data?.is_public ? '已设为公开' : '已设为私密');
        return true;
      }
    } catch (error) {
      message.error('操作失败');
      return false;
    }
  },

  // 获取用户统计
  getUserStats: async () => {
    try {
      const response = await apiClient.get('/video/stats');
      if (response.data.success) {
        set({ userStats: response.data.data });
      }
    } catch (error) {
      console.error('获取统计信息失败:', error);
    }
  },

  // 初始化时恢复未完成任务的轮询
  initializePolling: () => {
    const { generationHistory } = get();
    generationHistory.forEach(item => {
      if (item.task_id && (item.status === 'running' || item.status === 'queued' || item.status === 'submitted')) {
        // 添加到处理任务列表并开始轮询
        set(state => ({
          processingTasks: {
            ...state.processingTasks,
            [item.task_id]: {
              generationId: item.id,
              startTime: Date.now()
            }
          }
        }));
        get().pollTaskStatus(item.task_id, item.id);
      }
    });
  }
}));

export default useVideoStore;
