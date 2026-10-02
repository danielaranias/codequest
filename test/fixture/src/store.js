export function save(items) {
  if (!items.length) return 'skip';
  if (items.length > 5) return 'batch';
  return 'one';
}
