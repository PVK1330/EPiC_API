import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import compression from 'compression';

import routes from './routes/index.js';
import { getCorsOptions } from './config/frontendOrigins.js';
import { handleWebhook } from './modules/Candidate/Payments/stripepayment.controller.js';

const app = express();

app.use(compression({ level: 6, threshold: 1024 }));

app.use(cors(getCorsOptions()));

// Stripe webhooks must use raw body for signature verification.
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  handleWebhook,
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());       // must be BEFORE any route that reads req.cookies

const STATIC_CACHE = { maxAge: '7d', etag: true, lastModified: true };
app.use('/uploads', express.static('uploads', STATIC_CACHE));
app.use('/assets', express.static('assets', STATIC_CACHE));

// API Routes
app.use('/api', routes);

// API 404 handler
app.use('/api', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'API route not found',
  });
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('Unhandled server error:', err);
  res.status(err?.status || 500).json({
    status: 'error',
    message: err?.message || 'Internal server error',
    errors: err?.errors,
  });
});

export default app;


//test