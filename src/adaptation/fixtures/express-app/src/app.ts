import express from 'express';
import { requireAuth } from './middleware';

const app = express();

app.get('/', (req, res) => {
  res.send('<div id="home-hero">Welcome</div>');
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.status(200).send('<div data-testid="dashboard-main">Dashboard</div>');
});

app.post('/api/users', requireAuth, (req, res) => {
  res.status(201).json({ id: 1 });
});

app.get('/api/users', (req, res) => {
  res.status(200).json([]);
});

app.delete('/api/users/:id', requireAuth, (req, res) => {
  res.status(401).json({ error: 'Unauthorized' });
  res.status(403).json({ error: 'Forbidden' });
});

app.get('/login', (req, res) => {
  res.send('Login page');
});

app.get('/oauth/callback', (req, res) => {
  res.send('OAuth callback');
});
