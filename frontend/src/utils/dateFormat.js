/**
 * 日期格式化工具函数
 */

import moment from 'moment'

/**
 * 验证日期字符串是否有效
 * @param {string} dateStr - 日期字符串（YYYY-MM-DD格式）
 * @returns {boolean} 是否有效
 */
export const isValidDate = (dateStr) => {
  if (!dateStr) return true // 空值认为有效
  
  // 先检查格式
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false
  }
  
  // 使用 moment 的 strict 模式验证
  const m = moment(dateStr, 'YYYY-MM-DD', true)
  return m.isValid()
}

/**
 * 获取日期验证的详细错误信息
 * @param {string} dateStr - 日期字符串
 * @returns {string|null} 错误信息，如果有效则返回 null
 */
export const getDateValidationError = (dateStr) => {
  if (!dateStr) return null
  
  // 检查格式
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return '请输入正确的日期格式（YYYY-MM-DD）'
  }
  
  // 解析日期部分
  const parts = dateStr.split('-')
  const year = parseInt(parts[0])
  const month = parseInt(parts[1])
  const day = parseInt(parts[2])
  
  // 检查月份
  if (month < 1 || month > 12) {
    return `月份必须在1-12之间`
  }
  
  // 检查日期
  const daysInMonth = moment(`${year}-${month}`, 'YYYY-MM').daysInMonth()
  if (day < 1 || day > daysInMonth) {
    return `${month}月只有${daysInMonth}天`
  }
  
  // 使用 moment 严格验证
  const m = moment(dateStr, 'YYYY-MM-DD', true)
  if (!m.isValid()) {
    return '无效的日期'
  }
  
  return null
}

/**
 * 创建日期验证器（用于 Form.Item 的 rules）
 * @returns {Function} 验证器函数
 */
export const dateValidator = () => {
  return {
    validator(_, value) {
      if (!value) return Promise.resolve()
      
      const error = getDateValidationError(value)
      if (error) {
        return Promise.reject(new Error(error))
      }
      
      return Promise.resolve()
    }
  }
}

/**
 * 格式化日期为 YYYY-MM-DD
 * @param {string|Date} date - 日期字符串或日期对象
 * @returns {string} 格式化后的日期字符串
 */
export const formatDate = (date) => {
  if (!date) return ''
  
  // 如果已经是 YYYY-MM-DD 格式且有效，直接返回
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    // 验证是否为有效日期
    const m = moment(date, 'YYYY-MM-DD', true)
    if (m.isValid()) {
      return date
    }
    // 如果无效，返回空字符串避免错误
    return ''
  }
  
  // 使用 moment 格式化
  const m = moment(date)
  // 检查是否有效
  if (!m.isValid()) {
    return ''
  }
  
  return m.format('YYYY-MM-DD')
}

/**
 * 格式化日期时间为 YYYY-MM-DD HH:mm:ss
 * @param {string|Date} datetime - 日期时间字符串或日期对象
 * @returns {string} 格式化后的日期时间字符串
 */
export const formatDateTime = (datetime) => {
  if (!datetime) return ''
  
  const m = moment(datetime)
  // 检查是否有效
  if (!m.isValid()) {
    return ''
  }
  
  return m.format('YYYY-MM-DD HH:mm:ss')
}
