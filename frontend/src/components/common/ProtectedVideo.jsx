import React, { useEffect, useState } from 'react';
import { Button, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import api from '../../utils/api';

export function protectedVideoPath(value) {
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin && /^\/api\/video\/(generation|gallery-review)\/\d+\/asset$/.test(url.pathname) ? url.pathname.slice(4) : null;
  } catch { return null; }
}
export async function downloadProtectedVideo(src, name) {
  const path = protectedVideoPath(src);
  if (!path) throw Error('Video asset unavailable');
  const response = await api.get(path, { responseType: 'blob' });
  if (!response.data.type.startsWith('video/')) throw Error('Invalid video response');
  const url = URL.createObjectURL(response.data), link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function ProtectedVideo({ src, autoLoad = false, ...props }) {
  const { t } = useTranslation();
  const [requested, setRequested] = useState(null), [loaded, setLoaded] = useState(null);
  const path = protectedVideoPath(src), shouldLoad = autoLoad || props.autoPlay || requested === path;
  useEffect(() => {
    if (!path || !shouldLoad) return;
    const controller = new AbortController(); let url;
    api.get(path, { responseType: 'blob', signal: controller.signal }).then(response => {
      if (controller.signal.aborted) return;
      if (!response.data.type.startsWith('video/')) throw Error('Invalid video');
      url = URL.createObjectURL(response.data); setLoaded({ path, url });
    }).catch(() => { if (!controller.signal.aborted) setLoaded({ path, url: '' }); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [path, shouldLoad]);
  if (!path) return src ? <video src={src} {...props} /> : <span>{t('video.safety.unavailable')}</span>;
  if (!shouldLoad) return <Button onClick={() => setRequested(path)}>{t('video.safety.load')}</Button>;
  if (loaded?.path !== path) return <Spin />;
  if (!loaded.url) return <span>{t('video.safety.unavailable')}</span>;
  return <video {...props} src={loaded.url} />;
}
