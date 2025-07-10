import React, { useState } from 'react'
import { Button, message, Tooltip } from 'antd'
import { CopyOutlined, CheckOutlined } from '@ant-design/icons'

const CodeBlock = ({ children, className = '', ...props }) => {
  const [copied, setCopied] = useState(false)
  
  const language = className.replace(/language-/, '') || 'text'
  const code = String(children).replace(/\n$/, '')

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
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
      'xml': 'XML',
      'text': 'Text'
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
      {/* 代码块头部工具栏 */}
      <div className="code-block-header">
        <div className="code-block-language">
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
      
      {/* 代码内容区域 */}
      <div className="code-block-content">
        <pre>
          <code>
            {code}
          </code>
        </pre>
      </div>
    </div>
  )
}

export default CodeBlock
