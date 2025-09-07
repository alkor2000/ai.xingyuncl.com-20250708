/**
 * 标签数据导出工具
 */

export const exportTagStatistics = (statistics, groupName) => {
  const csvContent = [];
  
  // 添加标题
  csvContent.push(['标签统计报告 - ' + groupName]);
  csvContent.push(['生成时间', new Date().toLocaleString()]);
  csvContent.push([]);
  
  // 添加汇总信息
  csvContent.push(['汇总信息']);
  csvContent.push(['标签总数', statistics.total_tags]);
  csvContent.push(['已使用标签', statistics.tags?.filter(t => t.user_count > 0).length || 0]);
  csvContent.push(['标签覆盖用户', statistics.tags?.reduce((sum, t) => sum + t.user_count, 0) || 0]);
  csvContent.push([]);
  
  // 添加详细数据
  csvContent.push(['标签名称', '颜色', '使用人数', '用户列表']);
  statistics.tags?.forEach(tag => {
    csvContent.push([
      tag.name,
      tag.color,
      tag.user_count,
      tag.user_names || ''
    ]);
  });
  
  // 转换为CSV字符串
  const csv = csvContent.map(row => 
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  
  // 添加BOM以支持中文
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  
  // 创建下载链接
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `标签统计_${groupName}_${new Date().getTime()}.csv`;
  link.click();
  
  URL.revokeObjectURL(url);
};

export const exportUserTags = (users) => {
  const csvContent = [];
  
  // 添加标题
  csvContent.push(['用户标签导出']);
  csvContent.push(['导出时间', new Date().toLocaleString()]);
  csvContent.push([]);
  
  // 添加数据头
  csvContent.push(['用户ID', '用户名', '邮箱', '角色', '状态', '标签']);
  
  // 添加用户数据
  users.forEach(user => {
    const tags = user.tags?.map(t => t.name).join('; ') || '';
    csvContent.push([
      user.id,
      user.username,
      user.email,
      user.role,
      user.status,
      tags
    ]);
  });
  
  // 转换为CSV字符串
  const csv = csvContent.map(row => 
    row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  ).join('\n');
  
  // 添加BOM以支持中文
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  
  // 创建下载链接
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `用户标签_${new Date().getTime()}.csv`;
  link.click();
  
  URL.revokeObjectURL(url);
};
