export function droppedPermissions(existing, rendered) {
  const renderedByName = new Map(rendered.map(token => [token.token, token]));
  const dropped = [];
  for (const token of existing) {
    const next = renderedByName.get(token.token);
    if (!next) {
      dropped.push({ token: token.token, permissions: null });
      continue;
    }
    const kept = new Set(next.permissions ?? []);
    const lost = (token.permissions ?? []).filter(permission => !kept.has(permission));
    if (lost.length) dropped.push({ token: token.token, permissions: lost });
  }
  return dropped;
}

export function describeDropped(dropped) {
  return dropped
    .map(({ token, permissions }) => (permissions ? `${token}: ${permissions.join(", ")}` : `${token}: the whole token`))
    .join("\n");
}
