/**
 * 文档预览（画布 docx 产物）
 *
 * 把 docx 代码块里的 Markdown 用 react-markdown + remark-gfm 渲染成一张 A4 风格的
 * "纸"。exportDocx 用的是同一套 remark 解析（同一棵 mdast），所以预览的层级、
 * 列表、表格与下载得到的 .docx 一一对应，只是排版细节由 Word 决定。
 */

import React, { useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import { convertMathInMarkdown } from '../../../utils/canvas/latexToText'
import remarkGfm from 'remark-gfm'
import './DocPreview.less'

const DocPreview = ({ markdown, streaming = false }) => {
  const rootRef = useRef(null)
  // 流式生成中跟着新内容滚到底，用户能看到文档在往下长
  useEffect(() => {
    const el = rootRef.current
    if (streaming && el) el.scrollTop = el.scrollHeight
  }, [markdown, streaming])
  return (
    <div className="doc-preview" ref={rootRef}>
      <article className="doc-paper">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{convertMathInMarkdown(markdown || '')}</ReactMarkdown>
      </article>
    </div>
  )
}

export default DocPreview
