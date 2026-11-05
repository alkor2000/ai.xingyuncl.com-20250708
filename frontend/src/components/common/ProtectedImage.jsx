import React, { forwardRef, useEffect, useState } from 'react';
import { Image, Spin } from 'antd';
import api from '../../utils/api';
import { useTranslation } from 'react-i18next';

export function protectedImagePath(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin && /^\/api\/image\/(generation\/\d+\/asset|admin\/moderation\/\d+\/asset|reference\/[a-f0-9-]+)$/.test(url.pathname)
      ? `${url.pathname.slice(4)}${url.search}` : null;
  } catch { return null; }
}
export function useProtectedImage(src) {
  const [loaded, setLoaded] = useState(null);
  const path = protectedImagePath(src);
  useEffect(() => {
    if (!path) return;
    let cancelled = false, objectUrl;
    api.get(path, { responseType: 'blob' }).then(response => {
      if (cancelled) return;
      if (!response.data.type.startsWith('image/')) { setLoaded({ path, url: '' }); return; }
      objectUrl = URL.createObjectURL(response.data);
      setLoaded({ path, url: objectUrl });
    }).catch(() => { if (!cancelled) setLoaded({ path, url: '' }); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [path]);
  return path ? (loaded?.path === path ? loaded.url : null) : src;
}
const ProtectedImage = forwardRef(function ProtectedImage({ src, native = false, ...props }, ref) {
  const resolved = useProtectedImage(src);
  const { t } = useTranslation();
  if (resolved === '') return <span role="img" aria-label={props.alt}>{t('image.moderation.imageUnavailable')}</span>;
  if (!resolved) return <span role="img" aria-label={props.alt}><Spin size="small" /></span>;
  return native ? <img ref={ref} src={resolved} {...props} /> : <Image ref={ref} src={resolved} {...props} />;
});
export default ProtectedImage;
