import React from 'react';
import {createRoot} from 'react-dom/client';
import {ConfigProvider,Space} from 'antd';
import i18n from '../../frontend/src/utils/i18n';
import GalleryReviewSettings from '../../frontend/src/components/admin/settings/GalleryReviewSettings';
import GalleryReportButton from '../../frontend/src/components/common/GalleryReportButton';
const media=new URLSearchParams(location.search).get('media')==='video'?'video':'image';
await i18n.changeLanguage('zh-CN');
createRoot(document.getElementById('root')).render(<ConfigProvider><main style={{padding:16}}><h1>本机合成数据测试</h1><Space><GalleryReportButton media={media} id={501}/></Space><GalleryReviewSettings media={media}/></main></ConfigProvider>);
