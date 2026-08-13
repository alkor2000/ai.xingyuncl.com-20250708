/**
 * Markdown 代码块渲染组件
 *
 * 功能：
 *   - 显示语言标识徽章（带语言配色）
 *   - 一键复制代码到剪贴板
 *   - 自动换行展示，不产生横向滚动条
 *
 * v1.1 加固（配合 HTML 画布截断问题修复）：
 *   1) 代码文本提取从 String(children) 改为递归提取 extractTextFromNode
 *      原因：react-markdown 传入的 children 可能是数组（多个 text/element 节点），
 *      String(array) 会用逗号连接元素，导致复制出的代码被插入多余逗号或出现
 *      "[object Object]"，属于潜在的内容污染风险。
 *   2) 复制增加降级方案：非 HTTPS 环境或老浏览器下 navigator.clipboard 不可用时，
 *      使用临时 textarea + execCommand('copy') 兜底。
 *
 * 说明：Markdown 正文里的代码块本身是由 remark 按 CommonMark 规范解析的，
 *      不存在 HTML 画布那种"被内部反引号误闭合"的截断问题（那是旧正则的缺陷，
 *      已在 utils/htmlBlockParser 中彻底修复）。
 */

import React, { useState } from 'react'
import { Button, message, Tooltip } from 'antd'
import { CopyOutlined, CheckOutlined } from '@ant-design/icons'

/**
 * 递归提取 React 节点中的纯文本内容
 *
 * 处理场景：
 *   - 字符串 / 数字：直接转字符串
 *   - 数组：逐项递归后拼接（注意：不能用 join(',')，必须无分隔拼接）
 *   - React 元素：递归其 props.children
 *   - null / undefined / 布尔：忽略
 *
 * @param {*} node - React 子节点
 * @returns {string} 提取出的纯文本
 */
const extractTextFromNode = (node) => {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return ''
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }
  if (Array.isArray(node)) {
    return node.map(extractTextFromNode).join('')
  }
  if (typeof node === 'object' && node.props) {
    return extractTextFromNode(node.props.children)
  }
  return ''
}

const CodeBlock = ({ children, className = '', ...props }) => {
  const [copied, setCopied] = useState(false)

  const language = className.replace(/language-/, '') || 'text'

  /**
   * 获取当前代码内容
   * v1.1: 用递归提取替代 String(children)，避免数组被逗号连接
   */
  const getCurrentCode = () => {
    return extractTextFromNode(children).replace(/\n$/, '')
  }

  /**
   * 复制代码到剪贴板
   * v1.1: 增加 execCommand 降级方案，兼容非安全上下文
   */
  const handleCopy = async () => {
    const currentCode = getCurrentCode()
    if (!currentCode) {
      message.warning('没有可复制的代码')
      return
    }

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(currentCode)
      } else {
        // 降级方案：临时 textarea + execCommand
        const textarea = document.createElement('textarea')
        textarea.value = currentCode
        textarea.style.position = 'fixed'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(textarea)
        if (!ok) throw new Error('execCommand copy failed')
      }

      setCopied(true)
      message.success('代码已复制到剪贴板')
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('复制失败:', error)
      message.error('复制失败，请手动选择复制')
    }
  }

  const getLanguageDisplay = (lang) => {
    const languageMap = {
      'javascript': 'JavaScript',
      'js': 'JavaScript',
      'typescript': 'TypeScript',
      'ts': 'TypeScript',
      'jsx': 'React JSX',
      'tsx': 'React TSX',
      'python': 'Python',
      'py': 'Python',
      'java': 'Java',
      'c': 'C',
      'cpp': 'C++',
      'csharp': 'C#',
      'cs': 'C#',
      'php': 'PHP',
      'ruby': 'Ruby',
      'go': 'Go',
      'rust': 'Rust',
      'sql': 'SQL',
      'json': 'JSON',
      'yaml': 'YAML',
      'yml': 'YAML',
      'bash': 'Bash',
      'sh': 'Shell',
      'css': 'CSS',
      'html': 'HTML',
      'xml': 'XML'
    }
    return languageMap[lang.toLowerCase()] || lang.toUpperCase()
  }

  const getLanguageColor = (lang) => {
    const colorMap = {
      'javascript': '#f7df1e',
      'js': '#f7df1e',
      'typescript': '#007acc',
      'ts': '#007acc',
      'jsx': '#61dafb',
      'tsx': '#61dafb',
      'python': '#3776ab',
      'py': '#3776ab',
      'java': '#ed8b00',
      'html': '#e34f26',
      'css': '#1572b6',
      'json': '#292929',
      'bash': '#4eaa25',
      'sh': '#4eaa25',
      'sql': '#336791',
      'php': '#777bb4',
      'ruby': '#cc342d',
      'go': '#00add8',
      'rust': '#ce422b'
    }
    return colorMap[lang.toLowerCase()] || '#666666'
  }

  return (
    <div className="code-block-container">
      {/* 代码块头部工具栏 - 保持不变 */}
      <div className="code-block-header">
        <div className="code-block-language">
          {language !== 'text' && (
            <span 
              className="language-badge"
              style={{
                backgroundColor: getLanguageColor(language),
                color: ['javascript', 'js'].includes(language.toLowerCase()) ? '#000' : '#fff'
              }}
              data-language={language.toLowerCase()}
            >
              {getLanguageDisplay(language)}
            </span>
          )}
        </div>
        
        <Tooltip title={copied ? '已复制！' : '复制代码'}>
          <Button
            type="text"
            size="small"
            icon={copied ? <CheckOutlined /> : <CopyOutlined />}
            onClick={handleCopy}
            className={`copy-button ${copied ? 'copied' : ''}`}
          >
            {copied ? '已复制' : '复制'}
          </Button>
        </Tooltip>
      </div>
      
      {/* 代码内容区域 - 完全避免滚动，使用自动换行 */}
      <div className="code-block-content">
        <pre
          style={{
            margin: 0,
            padding: '16px',
            background: '#2d3748',
            color: '#d4d4d4',
            fontSize: '13px',
            lineHeight: '1.45',
            fontFamily: 'Consolas, Monaco, "Courier New", monospace',
            // 核心修改：完全禁用滚动，使用自动换行
            overflow: 'visible',        // 完全不创建滚动容器
            whiteSpace: 'pre-wrap',      // 保留格式但允许换行
            wordBreak: 'break-all',      // 允许在任意位置断行
            overflowWrap: 'break-word',  // 长单词换行
            maxWidth: '100%',            // 确保不超出容器宽度
            // 添加最小高度，避免内容跳动
            minHeight: '20px'
          }}
          {...props}
        >
          <code>{getCurrentCode()}</code>
        </pre>
      </div>
    </div>
  )
}

export default CodeBlock
