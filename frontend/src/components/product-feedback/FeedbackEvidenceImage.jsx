import { useEffect, useState } from "react";
import { fetchProductFeedbackEvidenceBlob } from "../../api/productFeedback";
import { formatFeedbackBytes } from "./feedbackLabels";
import "./product-feedback.css";
function FeedbackEvidenceImage({ feedbackID, evidence, scope }) {
  const [objectURL, setObjectURL] = useState(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let createdURL = null;
    fetchProductFeedbackEvidenceBlob(feedbackID, evidence.id, scope)
      .then((blob) => {
        if (cancelled) return;
        createdURL = URL.createObjectURL(blob);
        setObjectURL(createdURL);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (createdURL) URL.revokeObjectURL(createdURL);
    };
  }, [feedbackID, evidence.id, scope]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className="pf-evidence-item">
      {objectURL ? (
        <img
          className="pf-evidence-thumb"
          src={objectURL}
          alt={evidence.file_name}
          onClick={() => setOpen(true)}
        />
      ) : (
        <div className="pf-evidence-thumb is-placeholder">
          {failed
            ? "\u622A\u56FE\u52A0\u8F7D\u5931\u8D25"
            : "\u52A0\u8F7D\u4E2D\u2026"}
        </div>
      )}
      <div className="pf-evidence-caption" title={evidence.file_name}>
        {evidence.file_name} · {formatFeedbackBytes(evidence.byte_size)}
      </div>

      {open && objectURL && (
        <div
          className="pf-lightbox"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-label="查看截图"
        >
          <img src={objectURL} alt={evidence.file_name} />
        </div>
      )}
    </div>
  );
}
export { FeedbackEvidenceImage as default };
