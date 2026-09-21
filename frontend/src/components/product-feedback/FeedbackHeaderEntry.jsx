import {
  listFeedbackNotifications,
  readFeedbackNotification,
} from "../../api/productFeedback";
import { feedbackEventLabel } from "./feedbackLabels";
import { MessageSquare } from "../../components/product-feedback/icons";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../components/product-feedback/auth";
import FeedbackDialog from "./FeedbackDialog";
import "./product-feedback.css";
function FeedbackHeaderEntry() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [notificationError, setNotificationError] = useState("");
  const reloadNotifications = async () => {
    try {
      const feeds = await Promise.all([
        listFeedbackNotifications(false),
        ...(user?.role === "admin" ? [listFeedbackNotifications(true)] : []),
      ]);
      setNotifications(
        feeds
          .flatMap((feed) => feed.items)
          .sort(
            (a, b) =>
              Number(a.read) - Number(b.read) ||
              b.created_at.localeCompare(a.created_at),
          ),
      );
      setUnread(feeds.reduce((n, feed) => n + feed.unread, 0));
      setNotificationError("");
    } catch {
      setNotificationError("通知暂不可用，可稍后刷新");
    }
  };
  useEffect(() => {
    let active = true;
    const poll = async () => {
      if (!user || document.hidden) return;
      try {
        const feeds = await Promise.all([
          listFeedbackNotifications(false),
          ...(user.role === "admin" ? [listFeedbackNotifications(true)] : []),
        ]);
        if (active) {
          setNotifications(
            feeds
              .flatMap((feed) => feed.items)
              .sort(
                (a, b) =>
                  Number(a.read) - Number(b.read) ||
                  b.created_at.localeCompare(a.created_at),
              ),
          );
          setUnread(feeds.reduce((n, feed) => n + feed.unread, 0));
          setNotificationError("");
        }
      } catch {
        if (active) setNotificationError("通知暂不可用，可稍后刷新");
      }
    };
    setNotifications([]);
    setUnread(0);
    poll();
    const timer = window.setInterval(poll, 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [user?.id, user?.role]);

  const location = useLocation();
  const [menu, setMenu] = useState({ open: false, path: "" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  const pathname = location.pathname;
  const open = menu.open && menu.path === pathname;
  const setOpen = (value) => setMenu({ open: value, path: pathname });
  useEffect(() => {
    if (!open) return;
    const close = () => setMenu({ open: false, path: "" });
    const onPointerDown = (event) => {
      const target = event.target;
      if (
        !wrapRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      )
        close();
    };
    const updatePosition = () => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (rect)
        setPos({
          top: rect.bottom + 8,
          right: Math.max(8, window.innerWidth - rect.right),
        });
    };
    const onKey = (event) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);
  if (!user) return null;
  const isAdmin = user.role === "admin";
  const toggle = () => {
    if (!open && wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 8,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    }
    setOpen(!open);
  };
  const go = (path) => {
    setOpen(false);
    navigate(path);
  };
  return (
    <div ref={wrapRef} style={{ position: "relative", marginRight: "12px" }}>
      <button
        type="button"
        onClick={toggle}
        title="反馈"
        aria-label="反馈"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          position: "relative",
          width: "38px",
          height: "38px",
          borderRadius: "50%",
          border: "1px solid var(--ui-border)",
          background: open ? "var(--ui-hover)" : "transparent",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "18px",
          transition: "all 150ms ease",
        }}
        onMouseEnter={(e) => {
          if (!open)
            e.currentTarget.style.background = "var(--ui-surface-muted)";
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = "transparent";
        }}
      >
        <MessageSquare size={18} strokeWidth={1.7} aria-hidden="true" />
        {unread > 0 && <span className="pf-unread">{unread}</span>}
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="pf-launcher-menu"
            role="menu"
            style={{
              position: "fixed",
              top: pos.top,
              right: pos.right,
              zIndex: 1e3,
              minWidth: 176,
              maxHeight: `calc(100dvh - ${pos.top + 8}px)`,
              overflowY: "auto",
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setDialogOpen(true);
              }}
            >
              <span>✍️</span> 提交反馈
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => go("/feedback")}
            >
              <span>📋</span> 我的反馈
            </button>
            {isAdmin && (
              <button
                type="button"
                role="menuitem"
                onClick={() => go("/feedback/hub")}
              >
                <span>📥</span> 反馈中心
                <span className="pf-launcher-menu-hint">管理员</span>
              </button>
            )}
            <div className="pf-notification-list">
              <button type="button" onClick={reloadNotifications}>
                反馈通知 · {unread} 条未读 · 刷新
              </button>
              {notificationError && (
                <small role="status">{notificationError}</small>
              )}
              {notifications.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={async () => {
                    try {
                      await readFeedbackNotification(item.id, item.admin);
                      go(
                        (item.admin ? "/feedback/hub/" : "/feedback/") +
                          item.feedback_id,
                      );
                      reloadNotifications();
                    } catch {
                      setNotificationError("通知打开失败，请重试");
                    }
                  }}
                >
                  <strong>
                    {item.read ? "" : "● "}
                    {feedbackEventLabel(item.event_type)}
                  </strong>
                  <small>{item.body}</small>
                </button>
              ))}
              {!notifications.length && !notificationError && (
                <small>暂无反馈通知</small>
              )}
            </div>
          </div>,
          document.body,
        )}

      <FeedbackDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
export { FeedbackHeaderEntry as default };
