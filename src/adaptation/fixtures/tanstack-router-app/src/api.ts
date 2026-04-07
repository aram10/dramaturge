export async function fetchUsers() {
  return fetch('/api/users');
}

export async function createUser(data: unknown) {
  return fetch('/api/users', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
