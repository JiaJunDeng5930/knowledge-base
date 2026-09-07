import type { ButtonHTMLAttributes } from "react";

// 图标、热区、悬停和焦点样式均由 reader.css 管理；提示不占据日常阅读版面。
export function IconButton({label, className = "", ...props}: ButtonHTMLAttributes<HTMLButtonElement> & {label: string}) {
  return <button type="button" title={label} aria-label={label} className={"icon-button " + className} {...props}/>;
}
