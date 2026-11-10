import React, { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import { useTranslation } from 'react-i18next';
import api from '../../../utils/api';
import ProtectedVideo from '../../common/ProtectedVideo';
import ProtectedImage from '../../common/ProtectedImage';

export default function GalleryReviewSettings({ media = 'image' }) {
  const kind = media === 'video' ? 'video' : 'image';
  const reviewKey = `${kind}.galleryReview`;
  const { t } = useTranslation();
  const [state, setState] = useState('pending'), [page, setPage] = useState(1);
  const [data, setData] = useState({ data: [], total: 0 }), [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null), [reason, setReason] = useState('');
  const [audit, setAudit] = useState(null), [previewVersion, setPreviewVersion] = useState(0);
  const [seen, setSeen] = useState(false), [checked, setChecked] = useState(false), [busy, setBusy] = useState(false);
  const load = async () => {
    setLoading(true);
    try { setData((await api.get(`/${kind}/gallery-review`, { params: { state, page } })).data.data); }
    catch (e) { message.error(e.response?.data?.message || t('image.moderation.failed')); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [state, page, kind]);
  const act = async (action, body) => {
    setBusy(true);
    try {
      await api.post(`/${kind}/gallery-review/${selected.id}/${action}`, body);
      message.success(t('image.moderation.saved')); setSelected(null); await load();
    } catch (e) { message.error(e.response?.data?.message || t('image.moderation.failed')); }
    finally { setBusy(false); }
  };
  return <Space direction="vertical" style={{ width: '100%' }}>
    <Alert showIcon type="warning" message={t(`${reviewKey}.policy`)} />
    <Space wrap>
      <Select value={state} style={{ width: 180 }} options={['pending', 'approved', 'rejected', 'removed', 'reported'].map(value => ({ value, label: t(`${reviewKey}.${value}`) }))} onChange={v => { setState(v); setPage(1); }} />
      <Button onClick={load} loading={loading}>{t('image.moderation.refresh')}</Button>
    </Space>
    <Table scroll={{ x: 650 }} rowKey="id" dataSource={data.data} loading={loading} pagination={{ current: page, total: data.total, pageSize: 30, showSizeChanger: false, onChange: setPage }} columns={[
      { title: 'ID', dataIndex: 'id', width: 90 },
      { title: t('image.moderation.user'), dataIndex: 'username' },
      { title: t('image.moderation.prompt'), dataIndex: 'prompt', ellipsis: true },
      { title: t('image.moderation.status'), dataIndex: 'gallery_state', render: v => <Tag>{t(`${reviewKey}.${v}`)}</Tag> },
      { title: t('image.moderation.reports'), dataIndex: 'reports' },
      { title: t('image.moderation.actions'), render: (_, row) => <Button onClick={() => { setPreviewVersion(v => v + 1); setSelected(row); setReason(''); setSeen(false); setChecked(false); setAudit(null); }}>{t('image.moderation.reviewAction')}</Button> }
    ]} />
    <Modal title={t(`${reviewKey}.title`)} open={!!selected} onCancel={() => { if (!busy) setSelected(null); }} footer={null} width={800}>
      {selected && <Space direction="vertical" style={{ width: '100%' }}>
        <p>{selected.prompt}</p>
        {selected.gallery_reason && <Alert type="info" message={selected.gallery_reason} />}
        {selected.negative_prompt && <p>{selected.negative_prompt}</p>}
        {selected.has_asset ? kind === 'video' ? <ProtectedVideo key={previewVersion} autoLoad controls src={`/api/video/gallery-review/${selected.id}/asset`} style={{ width: '100%', maxHeight: 480 }} onEnded={() => setSeen(true)} onError={() => setSeen(false)} /> : <ProtectedImage key={previewVersion} native src={`/api/image/gallery-review/${selected.id}/asset`} alt={t('image.moderation.preview')} style={{ maxWidth: '100%', maxHeight: 480 }} onLoad={() => setSeen(true)} onError={() => setSeen(false)} /> :
          <Button loading={busy} onClick={() => act('import', {})}>{t('image.moderation.import')}</Button>}
        <Checkbox checked={checked} disabled={!seen || busy} onChange={e => setChecked(e.target.checked)}>{t(`${reviewKey}.confirm`)}</Checkbox>
        <Input.TextArea value={reason} onChange={e => setReason(e.target.value)} maxLength={500} showCount placeholder={t('image.moderation.reason')} />
        <Space wrap>
          <Button type="primary" disabled={busy || !seen || !checked || !reason.trim() || selected.gallery_state !== 'pending' || selected.moderation_status === 'block'} onClick={() => act('decision', { state: 'approved', reason, revision: selected.revision })}>{t(`${reviewKey}.approve`)}</Button>
          {selected.gallery_state === 'approved' && <Button danger disabled={busy || !reason.trim()} onClick={() => act('visibility', { action: 'down', reason, revision: selected.revision })}>{t(`${reviewKey}.takedown`)}</Button>}
          {['removed','reported'].includes(selected.gallery_state) && <Button type="primary" disabled={busy || !seen || !checked || !reason.trim() || selected.moderation_status !== 'pass'} onClick={() => act('visibility', { action: 'restore', reviewed: checked, reason, revision: selected.revision })}>{t(`${reviewKey}.restore`)}</Button>}
          <Button danger disabled={busy || !reason.trim() || selected.gallery_state === 'rejected'} onClick={() => act('decision', { state: 'rejected', reason, revision: selected.revision })}>{t(`${reviewKey}.reject`)}</Button>
        </Space>
        <Button onClick={async () => { try { setAudit((await api.get(`/${kind}/gallery-review/${selected.id}/events`)).data.data); } catch { message.error(t('image.moderation.failed')); } }}>{t('image.moderation.audit')}</Button>
        {audit && <div>
          <Typography.Paragraph>{t('image.galleryReview.threshold', { count: audit.threshold })}</Typography.Paragraph>
          <Table scroll={{ x: 600 }} size="small" rowKey={(_, i) => `report-${i}`} pagination={false} dataSource={audit.reports} columns={[
            { title: t('image.galleryReview.selectReason'), dataIndex: 'category', render: v => t(`image.galleryReview.reportCategory.${v}`) },
            { title: t('image.moderation.reason'), dataIndex: 'reason' },
            { title: t('image.galleryReview.time'), dataIndex: 'created_at' }
          ]} />
          <Table scroll={{ x: 600 }} size="small" rowKey={(_, i) => `event-${i}`} pagination={false} dataSource={audit.events} columns={[
            { title: t('image.galleryReview.actor'), dataIndex: 'actor_id' },
            { title: t('image.moderation.status'), dataIndex: 'state' },
            { title: t('image.moderation.reason'), dataIndex: 'reason' },
            { title: t('image.galleryReview.time'), dataIndex: 'created_at' }
          ]} />
        </div>}
      </Space>}
    </Modal>
  </Space>;
}
