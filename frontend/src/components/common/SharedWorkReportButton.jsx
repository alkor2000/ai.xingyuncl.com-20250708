import React, { useState } from 'react';
import { Button, Input, Modal, message } from 'antd';
import { useTranslation } from 'react-i18next';
import api from '../../utils/api';
export default function SharedWorkReportButton({ kind, id }) {
  const { t } = useTranslation();
  const [open,setOpen]=useState(false),[reason,setReason]=useState(''),[busy,setBusy]=useState(false);
  return <><Button onClick={()=>setOpen(true)}>{t('image.moderation.report')}</Button><Modal open={open} title={t('image.moderation.report')} onCancel={()=>!busy&&setOpen(false)} confirmLoading={busy} okButtonProps={{disabled:!reason.trim()}} onOk={async()=>{
    setBusy(true);try{await api.post(`/shared-works/${kind}/${id}/report`,{reason});message.success(t('image.moderation.reportSent'));setOpen(false);}catch(e){message.error(e.response?.data?.message||t('sharedWorks.failed'));}finally{setBusy(false);}
  }}><Input.TextArea aria-label={t('image.galleryReview.reportDetail')} maxLength={500} showCount value={reason} onChange={e=>setReason(e.target.value)} /></Modal></>;
}
