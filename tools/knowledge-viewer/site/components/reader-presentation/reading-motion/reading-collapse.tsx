"use client";

import type { ComponentProps, ReactElement } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export function ReadingCollapse(props: ComponentProps<typeof Collapsible>) {
  return <Collapsible {...props}/>;
}

export function ReadingCollapseTrigger({children}: {children: ReactElement}) {
  return <CollapsibleTrigger asChild>{children}</CollapsibleTrigger>;
}

// 使用同一展开动画，退出过程中保留高度，但立即停止命中测试与键盘访问。
export function ReadingCollapseContent({open, children}: {open: boolean; children: ReactElement}) {
  return <CollapsibleContent asChild className="reading-collapse" inert={!open} aria-hidden={!open}>{children}</CollapsibleContent>;
}
