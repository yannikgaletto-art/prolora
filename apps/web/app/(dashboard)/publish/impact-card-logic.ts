// GOAL-RUN8 T1.6/T1.7: pure editor mutations keep link moves and hook
// comparisons reversible, predictable and independently testable.

export function replaceFirstLine(content: string, replacement: string): string {
  const hook = replacement.trim();
  const firstBreak = content.indexOf('\n');
  if (firstBreak < 0) return hook;
  return `${hook}${content.slice(firstBreak)}`;
}

export function moveLinksToFirstComment(input: {
  content: string;
  bodyLinks: string[];
  firstComment: string;
  contextSentence: string;
}): { content: string; firstComment: string } {
  const uniqueLinks = [...new Set(input.bodyLinks)];
  let content = input.content;
  for (const link of uniqueLinks) {
    content = content.split(link).join('');
  }
  content = content.replace(/[ \t]+$/gmu, '').trim();

  const linkComment = `${input.contextSentence.trim()} ${uniqueLinks.join(' ')}`.trim();
  const firstComment = [input.firstComment.trim(), linkComment].filter(Boolean).join('\n\n');
  return { content, firstComment };
}
