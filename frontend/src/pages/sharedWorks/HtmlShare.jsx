import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Space, Spin, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import api from '../../utils/api';
import SharedWorkReportButton from '../../components/common/SharedWorkReportButton';
export default function HtmlShare() {
  const { userId, slug }=useParams(),{t}=useTranslation();
  const [data,setData]=useState(null),[failed,setFailed]=useState(false);
  useEffect(()=>{let active=true;setData(null);setFailed(false);api.get(`/shared-works/html/${encodeURIComponent(userId)}/${encodeURIComponent(slug)}/content`).then(r=>{if(active)setData(r.data.data);}).catch(()=>{if(active)setFailed(true);});return()=>{active=false;};},[userId,slug]);
  if(failed)return <Alert type="warning" showIcon message={t('sharedWorks.unavailable')} />;
  if(!data)return <Spin />;
  return <div style={{height:'100vh',display:'flex',flexDirection:'column'}}>
    <Space wrap style={{padding:12}}><Typography.Text strong>{data.title}</Typography.Text><Typography.Text>{t('sharedWorks.loginOnly')}</Typography.Text><SharedWorkReportButton kind="html" id={data.id}/></Space>
    {/* Scripts may run inside the opaque sandbox, never access login storage or the parent/report UI. */}
    <iframe title={data.title} sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={data.content} style={{border:0,width:'100%',flex:1}} />
  </div>;
}
