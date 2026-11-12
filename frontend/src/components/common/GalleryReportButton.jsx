import React, { useState } from 'react';
import { Button, Input, Modal, Select, Space, message } from 'antd';
import { useTranslation } from 'react-i18next';
import api from '../../utils/api';
import './GalleryReportButton.less';
const categories = ['sexual','violence','disgust','discrimination','political','minors','map','other'];
export default function GalleryReportButton({ media, id, onHidden }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false), [category, setCategory] = useState(), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [sent, setSent] = useState(false);
  const submit = async () => {
    if (!category) { message.warning(t('image.galleryReview.selectReason')); return; }
    setBusy(true);
    try {
      const response = await api.post(`/${media}/generation/${id}/report`, { category, reason: reason.trim() || t(`image.galleryReview.reportCategory.${category}`) });
      setSent(true); setOpen(false); message.success(t('image.moderation.reportSent'));
      if (response.data.data?.temporarily_hidden) onHidden?.();
    } catch (e) { message.error(e.response?.data?.message || t('image.moderation.failed')); }
    finally { setBusy(false); }
  };
  return <span className="gallery-report-control" onClick={e => e.stopPropagation()}>
    <Button className="gallery-report-button" size="small" disabled={sent} onClick={() => { setCategory(undefined); setReason(''); setOpen(true); }}>{t(sent ? 'image.moderation.reportSent' : 'image.moderation.report')}</Button>
    <Modal title={t('image.moderation.report')} open={open} onCancel={() => { if (!busy) setOpen(false); }} onOk={submit} confirmLoading={busy} okButtonProps={{ disabled: !category }} okText={t('common.confirm')} cancelText={t('common.cancel')}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Select aria-label={t('image.galleryReview.selectReason')} value={category} onChange={setCategory} placeholder={t('image.galleryReview.selectReason')} style={{ width: '100%' }} options={categories.map(value => ({ value, label: t(`image.galleryReview.reportCategory.${value}`) }))} />
        <Input.TextArea aria-label={t('image.galleryReview.reportDetail')} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} showCount placeholder={t('image.galleryReview.reportDetail')} />
      </Space>
    </Modal>
  </span>;
}
