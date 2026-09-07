type MarkdownNode = {type: string; value?: string; tagName?: string; properties?: Record<string, string>; children?: MarkdownNode[]};

// 只拆分呈现树中的文本节点，原始 Markdown、代码空白和数据库正文都不改变。
export function highlightMarkdownText(tree: MarkdownNode, query: string): void {
  const terms = [...new Set(query.trim().split(/\s+/).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!terms.length) return;
  const escaped = terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const expression = new RegExp(escaped.join("|"), "gi");
  function visit(node: MarkdownNode) {
    if (!node.children || node.tagName === "mark") return;
    node.children = node.children.flatMap(child => {
      if (child.type !== "text" || !child.value) {visit(child); return [child];}
      const result: MarkdownNode[] = [];
      let offset = 0;
      for (const match of child.value.matchAll(expression)) {
        const index = match.index!;
        if (index > offset) result.push({type: "text", value: child.value.slice(offset, index)});
        result.push({type: "element", tagName: "mark", properties: {"data-knowledge-match": "true"}, children: [{type: "text", value: match[0]}]});
        offset = index + match[0].length;
      }
      if (offset < child.value.length) result.push({type: "text", value: child.value.slice(offset)});
      return result;
    });
  }
  visit(tree);
}

export function readingHighlightPlugin(query: string) {
  return () => (tree: unknown) => highlightMarkdownText(tree as MarkdownNode, query);
}
