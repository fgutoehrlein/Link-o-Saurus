import type { Rule } from '../../shared/types';

export const parseCsvInput = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

export const describeRuleConditions = (rule: Rule): string => {
  const segments: string[] = [];
  if (rule.conditions.host) {
    segments.push(`Host entspricht: ${rule.conditions.host}`);
  }
  if (rule.conditions.urlIncludes && rule.conditions.urlIncludes.length > 0) {
    segments.push(`URL enthält: ${rule.conditions.urlIncludes.join(', ')}`);
  }
  if (rule.conditions.mime) {
    segments.push(`MIME-Typ: ${rule.conditions.mime}`);
  }
  return segments.length > 0 ? segments.join(' · ') : '—';
};

export const describeRuleActions = (rule: Rule): string => {
  const segments: string[] = [];
  if (rule.actions.addTags && rule.actions.addTags.length > 0) {
    segments.push(`Tags hinzufügen: ${rule.actions.addTags.join(', ')}`);
  }
  if (rule.actions.setCategoryId) {
    segments.push(`Kategorie setzen: ${rule.actions.setCategoryId}`);
  }
  return segments.length > 0 ? segments.join(' · ') : '—';
};
