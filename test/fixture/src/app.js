export function handle(req) {
  if (!req.user) return { status: 401 };
  if (req.items.length > 10) return { status: 413 };
  return { status: 200, items: req.items };
}

export function describe(res) {
  if (res.status >= 500) return 'broken';
  if (res.status >= 400) return 'refused';
  return 'fine';
}
