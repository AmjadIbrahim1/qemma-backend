// backend/src/app.js
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';

import webrtcRoutes from './modules/webrtc/webrtc.routes.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/', (req, res) => {
  res.json({ message: 'Backend is running!' });
});

app.use('/api/webrtc', webrtcRoutes);

export default app;
