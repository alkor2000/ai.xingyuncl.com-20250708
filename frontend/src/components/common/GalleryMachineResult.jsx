import React from 'react';
import {Alert,Space,Tag,Typography} from 'antd';
import {useTranslation} from 'react-i18next';
export default function GalleryMachineResult({result}) {
  const {t,i18n}=useTranslation();
  if(!result)return <Alert type="warning" message={t('image.galleryReview.machine.unchecked')}/>;
  const reason=r=>{const parts=r.text.split(' / ');return i18n.language.startsWith('zh')?parts[0]:parts.at(-1);};
  return <Alert type={result.decision==='reject'?'error':result.decision==='review'?'warning':'info'}
    message={t(`image.galleryReview.machine.${result.decision}`)} description={<Space direction="vertical" style={{width:'100%',overflowWrap:'anywhere'}}>
      <Space wrap>{result.categories.map(c=><Tag key={c}>{t(`image.galleryReview.reportCategory.${c}`)}</Tag>)}{result.mapDetected&&<Tag color="orange">{t('image.galleryReview.machine.map')}</Tag>}</Space>
      {result.reasons.map(r=><span key={r.code}>{reason(r)}</span>)}
      <Typography.Text>{t('image.galleryReview.confidence')}: {result.confidence==null?t('image.galleryReview.notProvided'):`${Math.round(result.confidence*100)}%`}</Typography.Text>
      {result.checks?.some(x=>x.scores)&&<Space wrap>{Object.entries(result.scores||{}).map(([key,value])=><Tag key={key}>{t(`image.galleryReview.reportCategory.${key}`)}: {value.toFixed(2)}</Tag>)}</Space>}
      <Typography.Text type="secondary">{t('image.galleryReview.scoreNote')}</Typography.Text>
    </Space>}/>;
}
