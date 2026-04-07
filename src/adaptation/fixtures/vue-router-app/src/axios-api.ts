import axios from 'axios';

export async function fetchUsers() {
  return axios.get('/api/users');
}

export async function updateUser(id: string, data: unknown) {
  return axios.put('/api/users/' + id, data);
}
