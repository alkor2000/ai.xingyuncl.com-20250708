/**
 * 画布 Word 产物 → 套用公文模板（弹窗）：把 docx 代码块的 Markdown 拆成字段与正文块交给 ApplyPanel
 */
import React, { useMemo, useState } from 'react'
import { Modal } from 'antd'
import { useTranslation } from 'react-i18next'
import ApplyPanel from './ApplyPanel'
import DocTemplateManager from './DocTemplateManager'
import { markdownToContent } from '../../utils/docTemplate/markdownToBlocks'
import './docTemplate.less'

const DocTemplateApplyModal = ({ open, onClose, markdown }) => {
  const { t } = useTranslation()
  const [managerOpen, setManagerOpen] = useState(false)
  const content = useMemo(() => (open ? markdownToContent(markdown || '') : null), [open, markdown])
  return (
    <>
      <Modal open={open} onCancel={onClose} footer={null} width={1000} title={t('chat.docTemplate.applyTitle')} destroyOnClose className="doc-template-modal">
        {content && <ApplyPanel content={content} onManage={() => setManagerOpen(true)} />}
      </Modal>
      <DocTemplateManager open={managerOpen} onClose={() => setManagerOpen(false)} initialTab="upload" />
    </>
  )
}

export default DocTemplateApplyModal
