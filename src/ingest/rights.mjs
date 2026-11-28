// Applies each source's register rights at its own step (architecture, rights table).
const confirmed = (s, r) => s.rights[r].status === 'confirmed';

export function truncateExcerpt(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–—-]+$/, '') + '…';
}

// What the pipeline may use and show for one item.
export function applyRights(item, source) {
  return {
    ...item,
    display: {
      headline: confirmed(source, 'headline') ? item.title : null,                    // renderer: not shown if null
      excerpt: confirmed(source, 'excerpt') && item.summary ? truncateExcerpt(item.summary, source.rights.excerpt.maxChars) : null,
    },
    analyseText: confirmed(source, 'analyse') ? `${item.title} ${item.summary}` : null, // ranking: metadata only if null
    groupText: confirmed(source, 'group') ? item.title : null,                          // grouping: exact URL only if null
    sourceType: source.sourceType,
    ownerGroup: source.ownerGroup,
    sections: source.sections,
  };
}
