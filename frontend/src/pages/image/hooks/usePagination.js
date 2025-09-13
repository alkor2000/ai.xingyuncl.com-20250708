/**
 * 分页Hook
 */

import { useState, useCallback } from 'react';
import { PAGINATION_CONFIG } from '../utils/constants';

export const usePagination = (initialPage = 1, initialPageSize = PAGINATION_CONFIG.defaultPageSize) => {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);

  // 处理分页变化
  const handlePageChange = useCallback((page, size) => {
    setCurrentPage(page);
    if (size && size !== pageSize) {
      setPageSize(size);
    }
    return { page, limit: size || pageSize };
  }, [pageSize]);

  // 重置分页
  const resetPagination = useCallback(() => {
    setCurrentPage(1);
    setPageSize(PAGINATION_CONFIG.defaultPageSize);
  }, []);

  // 获取分页配置
  const getPaginationConfig = useCallback((total) => ({
    current: currentPage,
    pageSize: pageSize,
    total: total,
    showSizeChanger: true,
    showTotal: (total) => `共 ${total} 条`,
    pageSizeOptions: PAGINATION_CONFIG.pageSizeOptions
  }), [currentPage, pageSize]);

  return {
    currentPage,
    pageSize,
    setCurrentPage,
    setPageSize,
    handlePageChange,
    resetPagination,
    getPaginationConfig
  };
};
