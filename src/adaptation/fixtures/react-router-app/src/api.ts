export async function loadWidgets() {
  return fetch('/api/widgets');
}

export async function createItem() {
  return fetch('/api/items', {
    method: 'POST',
  });
}
