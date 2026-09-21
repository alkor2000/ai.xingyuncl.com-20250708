import {
  MessageOutlined,
  CheckCircleOutlined,
  PictureOutlined,
  CloseOutlined,
  ArrowLeftOutlined,
  InboxOutlined,
  ReloadOutlined,
  RobotOutlined,
} from "@ant-design/icons";
const icon = (Component) =>
  function Icon({ size = 16, strokeWidth, ...props }) {
    return <Component {...props} style={{ fontSize: size, ...props.style }} />;
  };
export const MessageSquare = icon(MessageOutlined),
  MessageSquarePlus = icon(MessageOutlined),
  CheckCircle2 = icon(CheckCircleOutlined),
  ImagePlus = icon(PictureOutlined),
  X = icon(CloseOutlined),
  ArrowLeft = icon(ArrowLeftOutlined),
  Inbox = icon(InboxOutlined),
  RefreshCw = icon(ReloadOutlined),
  Bot = icon(RobotOutlined);
