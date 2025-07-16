/**
 * 统计状态管理
 */

import { create } from 'zustand';
import apiClient from '../utils/api';
import socketManager from '../utils/socket';

const useStatsStore = create((set, get) => ({
  // 状态
  realtimeStats: {
    online_users: 0,
    today_active_users: 0,
    today_messages: 0,
    today_tokens: 0,
    today_conversations: 0,
    total_users: 0,
    popular_models: [],
    timestamp: null
  },
  onlineCount: 0,
  loading: false,
  connected: false,

  // 初始化WebSocket连接
  initializeSocket: () => {
    const socket = socketManager.connect();
    
    if (!socket) return;

    // 监听在线人数更新
    socket.on('online:count', (data) => {
      set({ onlineCount: data.count });
    });

    // 监听统计数据更新
    socket.on('stats:update', (data) => {
      set({ realtimeStats: data });
    });

    // 监听连接状态
    socket.on('connect', () => {
      set({ connected: true });
      // 请求最新统计数据
      socket.emit('stats:get');
    });

    socket.on('disconnect', () => {
      set({ connected: false });
    });
  },

  // 断开WebSocket连接
  disconnectSocket: () => {
    socketManager.disconnect();
    set({ connected: false });
  },

  // 获取实时统计（通过API）
  fetchRealtimeStats: async () => {
    set({ loading: true });
    try {
      const response = await apiClient.get('/stats/realtime');
      set({ 
        realtimeStats: response.data.data,
        loading: false 
      });
      return response.data.data;
    } catch (error) {
      console.error('获取实时统计失败:', error);
      set({ loading: false });
      throw error;
    }
  },

  // 发送心跳（通过API）
  sendHeartbeat: async () => {
    try {
      await apiClient.post('/stats/heartbeat');
    } catch (error) {
      console.error('发送心跳失败:', error);
    }
  },

  // 格式化数字显示
  formatNumber: (num) => {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  },

  // 获取模型使用百分比
  getModelUsagePercentage: (modelName) => {
    const stats = get().realtimeStats;
    const model = stats.popular_models.find(m => m.model_name === modelName);
    if (!model || stats.today_messages === 0) return 0;
    
    return Math.round((model.usage_count / stats.today_messages) * 100);
  }
}));

export default useStatsStore;
