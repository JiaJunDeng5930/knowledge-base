"use client";

import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { ReadingDisclosure } from "@/components/reading-view";
import { PageBlockList } from "./block-list";
import { PageLink } from "./content";
import { buildReferenceSections, type KnowledgeModel, type Navigate } from "./model";

export function PageReferences({id, model, from, navigate}: {id: string; model: KnowledgeModel; from: number; navigate: Navigate}) {
  const sections = useMemo(() => buildReferenceSections(model, id), [model, id]);
  return <>{sections.map(section => <ReadingDisclosure key={section.direction}
    id={"references:" + section.direction} className="page-reference-section" initiallyOpen
    title={<><ChevronRight className="page-reference-caret" aria-hidden="true"/><h2 title={section.description}>{section.label}</h2><span className="sr-only">：{section.description}</span></>}>
    <div className="page-reference-groups" data-reference-direction={section.direction}>
      {section.groups.map(group => <section className="page-reference-group" key={group.key}>
        <nav className="page-reference-context" aria-label={section.direction === "incoming" ? "引用来源位置" : "所引内容位置"}>
          {group.context.length ? <ol>{group.context.map(part => <li key={part.id}>
            <PageLink target={{kind: "bullet", id: part.id, focus: group.blocks[0].id}} appearance="context" {...{from, navigate}}
              title={"在「" + part.label + "」中定位原文"}>{part.label}</PageLink>
          </li>)}</ol> : <span>{group.key === "unavailable" ? "来源暂不可用" : "根级内容"}</span>}
        </nav>
        <PageBlockList blocks={group.blocks} surface={{kind: "reference", key: section.direction + ":" + group.key}} {...{from, navigate}}/>
      </section>)}
    </div>
  </ReadingDisclosure>)}</>;
}
